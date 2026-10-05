import { addCents } from './money.js';
import { timestampMs } from './time.js';

const STAGES = { store: 0, platform: 1, payment: 2 };
const MAX_CENTS = 1000000000000;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function cents(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) throw new TypeError(`${field} 必须是安全整数分`);
  return value;
}
function actionUrl(value, origins) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin)) throw new TypeError('优惠操作链接未获允许');
  return url.href;
}
function qualify(requirements, buyer) {
  let unknown = false;
  for (const rule of requirements) {
    if (!rule || !['member', 'new_customer', 'owned_coupon', 'payment_method'].includes(rule.type)) throw new TypeError('优惠资格类型无效');
    if (['owned_coupon', 'payment_method'].includes(rule.type) && !nonempty(rule.value)) throw new TypeError('优惠资格参数缺失');
    if (buyer?.verified !== true || (!nonempty(buyer.eligibilityKey) || buyer.eligibilityKey === 'public')) { unknown = true; continue; }
    let result;
    if (rule.type === 'member') result = typeof buyer.member === 'boolean' ? buyer.member : null;
    if (rule.type === 'new_customer') result = typeof buyer.newCustomer === 'boolean' ? buyer.newCustomer : null;
    if (rule.type === 'owned_coupon') result = Array.isArray(buyer.ownedCouponIds) ? buyer.ownedCouponIds.includes(rule.value) : null;
    if (rule.type === 'payment_method') result = Array.isArray(buyer.paymentMethods) ? buyer.paymentMethods.includes(rule.value) : null;
    if (result === false) return 'ineligible';
    if (result === null || result === undefined) unknown = true;
  }
  return unknown ? 'unknown' : 'eligible';
}
function compatible(offer, selected) {
  return selected.every(other => offer.stackable && other.stackable &&
    !(offer.exclusiveGroup && offer.exclusiveGroup === other.exclusiveGroup) &&
    !offer.excludes.includes(other.id) && !other.excludes.includes(offer.id));
}
function rounded(numerator, mode) {
  if (mode === 'floor') return numerator / 10000n;
  if (mode === 'ceil') return (numerator + 9999n) / 10000n;
  return (numerator + 5000n) / 10000n;
}
function apply(offer, state, originalItem) {
  const total = addCents(state.itemCents, state.shippingCents);
  const basis = offer.thresholdBasis === 'original_item' ? originalItem :
    (offer.thresholdBasis === 'current_total' ? total : state.itemCents);
  if (basis < offer.minSpendCents) return null;
  const target = offer.type === 'shipping' ? state.shippingCents :
    (offer.stage === 'payment' ? total : state.itemCents);
  let discount;
  if (offer.type === 'percent') {
    const product = BigInt(target) * BigInt(offer.roundingTarget === 'discount' ? offer.discountBps : 10000 - offer.discountBps);
    const amount = Number(rounded(product, offer.rounding));
    discount = offer.roundingTarget === 'discount' ? amount : target - amount;
  } else if (offer.type === 'each') {
    const repeated = BigInt(Math.floor(basis / offer.minSpendCents)) * BigInt(offer.amountCents);
    discount = Number(repeated > BigInt(target) ? BigInt(target) : repeated);
  } else discount = offer.amountCents;
  discount = Math.min(discount, offer.capCents ?? target, target);
  if (discount <= 0) return null;
  let itemCents = state.itemCents, shippingCents = state.shippingCents;
  if (offer.type === 'shipping') shippingCents -= discount;
  else {
    const itemPart = Math.min(itemCents, discount);
    itemCents -= itemPart;
    shippingCents -= discount - itemPart;
  }
  return { itemCents, shippingCents, step: {
    id: offer.id, label: offer.label, stage: offer.stage, discountCents: discount,
    beforeCents: total, afterCents: addCents(itemCents, shippingCents),
    claimUrl: offer.claimUrl, claimRequired: offer.claimRequired,
    endsAt: offer.endsAt,
    paymentMethods: offer.requirements.filter(rule => rule.type === 'payment_method').map(rule => rule.value)
  } };
}

export function solveOffers({ itemCents, shippingCents, offers, sku, size, shippingRegion,
  buyer = null, coverage = 'unknown', allowedActionOrigins = [], now = Date.now() }) {
  cents(itemCents, '商品金额');
  const knownShipping = shippingCents !== null && shippingCents !== undefined;
  if (knownShipping) cents(shippingCents, '运费');
  if (!Number.isFinite(now)) throw new TypeError('计算时间无效');
  if (!Array.isArray(offers) || offers.length > 12) throw new TypeError('优惠规则必须是最多十二条的数组');
  const candidates = [], excluded = [], ids = new Set();
  const reject = (offer, status, reason) => excluded.push({ id: offer.id, label: offer.label || offer.id, status, reason });
  for (const raw of offers) {
    if (!raw || !nonempty(raw.id) || ids.has(raw.id)) throw new TypeError('优惠 id 必须非空且唯一');
    ids.add(raw.id);
    const offer = { ...raw, label: String(raw.label || raw.id) };
    if (!nonempty(raw.sku) || !nonempty(raw.size)) { reject(offer, 'unknown', '适用商品或尺码未确认'); continue; }
    if (raw.sku !== sku || raw.size !== size) { reject(offer, 'not_applicable', '不适用于目标商品或尺码'); continue; }
    if (raw.confirmed !== true) { reject(offer, 'unknown', '优惠未确认'); continue; }
    if (raw.startsAt === undefined || raw.endsAt === undefined) { reject(offer, 'unknown', '优惠有效期未确认'); continue; }
    const from = timestampMs(raw.startsAt), to = timestampMs(raw.endsAt);
    if (from >= to) throw new TypeError('优惠起止时间无效');
    if (now >= to) { reject(offer, 'expired', '优惠已过期'); continue; }
    if (now < from) {
      excluded.push({ id: raw.id, label: offer.label, status: 'upcoming', reason: '活动尚未开始', startsAt: raw.startsAt });
      continue;
    }
    if (!Object.hasOwn(STAGES, raw.stage) || !['fixed', 'percent', 'each', 'shipping'].includes(raw.type)) throw new TypeError('优惠阶段或类型无效');
    if (typeof raw.stackable !== 'boolean' || raw.order === undefined || raw.requirements === undefined || raw.regions === undefined) { reject(offer, 'unknown', '叠加、顺序或适用条件未确认'); continue; }
    if (!Number.isSafeInteger(raw.order) || raw.order < 0 || !Array.isArray(raw.requirements) || !Array.isArray(raw.regions) || !raw.regions.every(nonempty)) throw new TypeError('优惠顺序或适用条件无效');
    if (raw.regions.length && (!shippingRegion || !raw.regions.includes(shippingRegion))) {
      reject(offer, shippingRegion ? 'not_applicable' : 'unknown', '收货地区不满足或未确认'); continue;
    }
    const eligibility = qualify(raw.requirements, buyer);
    if (eligibility !== 'eligible') { reject(offer, eligibility, eligibility === 'unknown' ? '用户优惠资格未确认' : '用户不满足优惠资格'); continue; }
    if (raw.claimRequired !== undefined && typeof raw.claimRequired !== 'boolean') throw new TypeError('领券状态无效');
    if (raw.claimRequired === true && !raw.claimUrl) { reject(offer, 'unknown', '缺少已核验领券入口'); continue; }
    offer.claimUrl = actionUrl(raw.claimUrl, allowedActionOrigins);
    offer.claimRequired = raw.claimRequired === true;
    offer.minSpendCents = cents(raw.minSpendCents ?? 0, '优惠门槛');
    if (offer.minSpendCents > 0 && !['original_item', 'current_item', 'current_total'].includes(raw.thresholdBasis)) { reject(offer, 'unknown', '优惠门槛口径未确认'); continue; }
    offer.thresholdBasis = raw.thresholdBasis || 'current_item';
    if (raw.capCents !== undefined) offer.capCents = cents(raw.capCents, '优惠上限');
    if (raw.type === 'percent') {
      if (!Number.isInteger(raw.discountBps) || raw.discountBps < 0 || raw.discountBps > 10000) throw new TypeError('优惠折扣基点无效');
      if (!['floor', 'ceil', 'nearest'].includes(raw.rounding) || !['discount', 'payable'].includes(raw.roundingTarget)) { reject(offer, 'unknown', '折扣舍入口径未确认'); continue; }
    } else offer.amountCents = cents(raw.amountCents, '优惠金额');
    if (raw.type === 'each' && offer.minSpendCents <= 0) throw new TypeError('每满减门槛必须大于零');
    if (raw.exclusiveGroup !== undefined && !nonempty(raw.exclusiveGroup)) throw new TypeError('互斥组无效');
    offer.excludes = raw.excludes ?? [];
    if (!Array.isArray(offer.excludes) || !offer.excludes.every(nonempty)) throw new TypeError('互斥列表无效');
    if (!knownShipping && (raw.type === 'shipping' || raw.stage === 'payment' || raw.thresholdBasis === 'current_total')) { reject(offer, 'unknown', '运费未确认，无法计算订单或支付优惠'); continue; }
    candidates.push(offer);
  }
  candidates.sort((a, b) => STAGES[a.stage] - STAGES[b.stage] || a.order - b.order);
  const ambiguous = new Set();
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    if (candidates[i].stage === candidates[j].stage && candidates[i].order === candidates[j].order && compatible(candidates[j], [candidates[i]])) {
      ambiguous.add(candidates[i].id); ambiguous.add(candidates[j].id);
    }
  }
  const usable = candidates.filter(offer => {
    if (!ambiguous.has(offer.id)) return true;
    reject(offer, 'unknown', '可叠加优惠的先后顺序不明确'); return false;
  });
  const initial = { itemCents, shippingCents: knownShipping ? shippingCents : 0 };
  addCents(initial.itemCents, initial.shippingCents);
  let best = { ...initial, selected: [], steps: [] };
  function visit(index, state, selected, steps) {
    if (index === usable.length) {
      const total = addCents(state.itemCents, state.shippingCents), bestTotal = addCents(best.itemCents, best.shippingCents);
      if (total < bestTotal || (total === bestTotal && selected.length < best.selected.length)) best = { ...state, selected, steps };
      return;
    }
    visit(index + 1, state, selected, steps);
    const offer = usable[index];
    if (!compatible(offer, selected)) return;
    const next = apply(offer, state, itemCents);
    if (next) visit(index + 1, next, [...selected, offer], [...steps, next.step]);
  }
  visit(0, initial, [], []);
  const selectedIds = new Set(best.selected.map(offer => offer.id));
  for (const offer of usable) if (!selectedIds.has(offer.id)) reject(offer, 'not_selected', '互斥、门槛或组合成本导致未采用');
  const needsVerification = [];
  if (coverage !== 'complete') needsVerification.push('优惠数据不完整');
  if (!knownShipping) needsVerification.push('运费未确认');
  for (const item of excluded.filter(item => item.status === 'unknown')) needsVerification.push(`${item.label}：${item.reason}`);
  if (best.itemCents === 0) needsVerification.push('零元商品金额需结账核验');
  const totalCents = knownShipping ? addCents(best.itemCents, best.shippingCents) : null;
  return {
    complete: needsVerification.length === 0, status: needsVerification.length ? 'needs_verification' : 'calculated',
    itemCents: best.itemCents, shippingCents: knownShipping ? best.shippingCents : null, totalCents,
    savedCents: addCents(initial.itemCents, initial.shippingCents) - addCents(best.itemCents, best.shippingCents),
    applied: best.steps, excluded, needsVerification,
    validUntil: best.selected.map(offer => offer.endsAt).sort((a, b) => timestampMs(a) - timestampMs(b))[0] || null,
    usesPrivateEligibility: best.selected.some(offer => offer.requirements.length > 0),
    nextReviewAt: excluded.filter(item => item.status === 'upcoming').map(item => item.startsAt).sort((a, b) => timestampMs(a) - timestampMs(b))[0] || null
  };
}

export function purchaseSteps(plan) {
  const steps = [{ text: '确认 KX0493、L 码、颜色、地区与库存。', url: null }];
  if (!plan.complete) {
    steps.push({ text: '先核验缺失的优惠资格和金额条件，当前估算不能作为确定到手价。', url: null });
    return steps;
  }
  for (const offer of plan.applied) {
    if (offer.claimRequired) steps.push({ text: `领取“${offer.label}”，核对活动有效期和使用条件。`, url: offer.claimUrl });
    if (offer.paymentMethods.length) steps.push({ text: `支付时使用：${offer.paymentMethods.join('、')}，并确认优惠已生效。`, url: null });
    else steps.push({ text: `核对“${offer.label}”已减免 ${(offer.discountCents / 100).toFixed(2)} 元。`, url: null });
  }
  steps.push({ text: '在结账页核对商品、运费、优惠与最终实付；不一致时重新核验。', url: null });
  return steps;
}
