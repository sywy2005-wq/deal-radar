# 结构化优惠与购买建议契约

本轮实现的是授权 JSON 接口的规则读取和组合计算，不是京东／天猫网页、图片或登录账户的自动抓取。
生产来源仍关闭；默认没有报价或领券链接。来源和商家核验仍按 README 执行。

## 原价与优惠价

只有 priceBasis=item_price、quantity=1 且 offers 为数组时，才根据原价计算优惠。
priceBasis=payable_item_price 表示来源已给优惠后金额，不再次扣减 offers，以避免重复计算。
原价口径不明确时不输出确定的优惠价。运费和优惠覆盖不完整也不能视为确定到手价。

## offers 规则

每次最多十二条，枚举所有兼容组合并按已确认顺序执行。来源可在适配器中提取并转换平台规则，但不得默认补齐未知资格。

必填字段：
- id、label、sku=KX0493、size=L，confirmed=true。
- startsAt、endsAt：真实日历时间，包含时区；到 endsAt 即过期。
- stage：store / platform / payment，依次执行；order 为阶段内非负整数。
- stackable：明确的布尔值。false 表示无法与其它优惠组合；可叠加规则的执行顺序必须明确。
- regions：地区限制列表；空数组明确表示无限制。
- requirements：资格列表；空数组明确表示公共优惠。
- type：fixed / percent / each / shipping。
- fixed、each、shipping 使用 amountCents；percent 使用 discountBps。
- percent 还需 rounding=floor/ceil/nearest 及 roundingTarget=discount/payable，避免一分钱舍入差异。

可选字段：
- minSpendCents 门槛；非零时明确 thresholdBasis=original_item/current_item/current_total。
- each 按门槛的整数倍减免，门槛必须大于零。
- capCents 限额；exclusiveGroup 同组互斥；excludes 为互斥优惠 id 列表。
- claimRequired=true 时必须有 claimUrl；链接仅可来自来源配置的 allowedActionOrigins。

requirements 类型：
- member / new_customer：核验会员或新客状态。
- owned_coupon：value 为优惠券 id。
- payment_method：value 为支付方式标识，不能包含卡号或个人身份信息。

私有资格必须由来源验证 buyerContext，verified=true，且 eligibilityKey 与报价一致。
eligibilityKey 必须是匿名、稳定的购买条件标识；public 不能用于私有资格。
member/newCustomer 为布尔值，ownedCouponIds/paymentMethods 为已核验数组。
未知资格不享受对应优惠，并使组合整体保持待核验；已明确不符合资格的优惠直接排除。
优惠后的零元商品金额保持待核验，不形成确定低价结论。

## 输出与验收

- pricing 说明已采用、未采用优惠及原因，列出每一步减免、前后金额和领券／支付步骤。
- 无法确认的组合仅是估算，不参加历史最低值比较。
- 已采用优惠的最早到期时间保存在 validUntil；到期后不能继续使用缓存优惠价。
- nextReviewAt 仅提示已知活动的开始时间，不承诺届时价格或库存。
- 购买建议使用各来源最新记录，按相同购买条件比较历史；缺货、过期或条件不完整时不建议立即购买。
- 至少三个不同观测时间且跨度不少于二十四小时，才描述已采集区间的相对低点；更少样本明确显示不足。
- 即使处于观察低点，仍要求结账核验，不声称全网最低或预测未来最低。

验收覆盖：互斥组合、明确顺序、满减口径、重复满减、限额、运费、支付优惠、资格未知／不符、
活动有效期、折扣舍入、领取链接白名单、优惠价重复扣减、缺货／过期建议和跨条件历史隔离。

优惠后来源同时给出 offers 时，还须提供未来有效的 priceValidUntil，才能将该价参与比较；
否则优惠仍不重复扣减，但应用明细有效性保持待核验。
原价计算方案保存最早所用活动到期时间。日期验证拒绝不存在的日历日期。

去重键保留响应摘要、解析器版本、优惠组合和有效期；同价记录的规则变化不会被旧记录覆盖。
购买建议同时检查原报价与所选优惠的到期时间，任一到期都要求刷新；缺货时不提供领券执行步骤。

当前来源比较只纳入新鲜、在库且条件完整的报价，按颜色、地区、数量、优惠人群和价格口径分组；
不足两个来源时不形成来源比较。最低值仅指当前已采集来源，未核验或过期来源不参与排名。
