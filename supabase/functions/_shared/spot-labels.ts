import { preferenceKeys, type Preference, type SpotLabels } from './discovery-contract.ts'

const patterns: Record<Preference, { positive: RegExp; negative: RegExp; topic: RegExp }> = {
  catch: {
    positive: /鱼(?:情|口|获)(?:很|挺|真|比较)?(?:好|不错)|连[竿杆]|上鱼(?:真|特别|很|挺)?多|鱼(?:真|特别|很|挺)?多/,
    negative: /鱼(?:情|口|获)(?:不好|不佳|不多|很少|很差|差|慢|一般)|鱼(?:不好钓|不多|很少)|没(?:有)?口|没上鱼|空军|小(?:杂)?鱼多/,
    topic: /鱼(?:情|口|获|多)|连[竿杆]|上鱼|咬钩|上钩|爆护|(?:收获|钓了|钓到|上了).{0,18}(?:鱼|条|尾|斤)/
  },
  quiet: {
    positive: /(?:人|钓友)(?:很|挺|比较|较|特别|非常)?少|没(?:有)?多少人|几乎(?:没(?:有)?人|无人)|不拥挤|空位不少/,
    negative: /(?:人|钓友)(?:不算少|不少|很多|挺多|特别多|太多|多)|(?:很多|好多人|许多)(?:人|钓友)|坐满|爆满|拥挤/,
    topic: /人|钓友|拥挤|空位/
  },
  setting: {
    positive: /环境(?:很|挺|真|比较)?(?:好|不错)|(?:水|岸|岸边|岸上)(?:很|挺|真|比较)?干净|水(?:质)?(?:很|挺|真|比较)?(?:清澈|清亮)|水清(?:岸净|[，。！、\s]|$)|水质(?:很|挺)?(?:好|不错)|风景(?:很|挺)?(?:好|不错|优美)/,
    negative: /环境(?:不太|不|很差|差)|水(?:质)?(?:很脏|发臭|浑浊|太浑)|垃圾(?:很多|多|遍地)|遍地垃圾|岸边(?:很脏|脏乱)/,
    topic: /环境|干净|水质|清澈|岸|风景|田园风光|垃圾/
  },
  parking: {
    positive: /停车(?:很|挺)?(?:方便|便利)|有(?:专用|免费)?停车场|车位(?:很多|充足)/,
    negative: /停车难|停车(?:不便|不方便|受限)|无法停车|没有停车场|没有车位/,
    topic: /停车|车位/
  },
  family: {
    positive: /适合(?:亲子|带娃|遛娃)|亲子(?:活动|设施|游乐|体验|钓鱼|垂钓)|儿童游乐区/,
    negative: /不适合(?:儿童|亲子|带娃)|儿童(?:禁止|不得)入内|谢绝儿童/,
    topic: /亲子|儿童|遛娃|带娃/
  }
}
const speculative = /[?？]|(?:听说|据说|希望|要是|如果|想找|不知道|不确定|有没有|有无|是否)/
const negation = /(?:没有|并不|不太|不是|不算|不|未|没)[\u4e00-\u9fff]{0,3}$/
const limit = 90

export function spotLabelText(description: string): string {
  return description.replace(/https?:\/\/[^\s，。；！？、（）【】“”<>]+/gu, '').trim().slice(0, 700)
}

export function mentionsFishingRestriction(description: string): boolean {
  return /禁止(?:在此|下竿|钓鱼|垂钓)|谢绝垂钓|不让钓|(?<![非解])禁钓|禁止靠近/.test(description)
}

function sentences(description: string) {
  return description.match(/[^。！？?！；;\n\r]+[。！？?!；;]?/gu)?.map(value => value.trim()) ?? []
}

export function evidenceSpotLabels(description: string): SpotLabels {
  const text = spotLabelText(description)
  if (mentionsFishingRestriction(text)) return {}
  const clauses = sentences(text)
  const labels: SpotLabels = {}
  for (const key of preferenceKeys) {
    const { positive, negative } = patterns[key]
    if (negative.test(text.replace(/不拥挤/g, ''))) continue
    const evidence = clauses.find(clause => {
      if (clause.length > limit || speculative.test(clause)) return false
      const hit = positive.exec(clause)
      return hit != null && !negation.test(clause.slice(0, hit.index))
    })
    if (evidence) labels[key] = evidence
  }
  return labels
}

export function verifiedSpotLabels(description: string, value: unknown): SpotLabels {
  const text = spotLabelText(description)
  if (!value || typeof value !== 'object' || mentionsFishingRestriction(text)) return {}
  const clauses = sentences(text)
  const labels: SpotLabels = {}
  for (const key of preferenceKeys) {
    const snippet = (value as Record<string, unknown>)[key]
    if (typeof snippet !== 'string') continue
    const evidence = snippet.trim()
    if (evidence.length < 3 || evidence.length > limit || speculative.test(evidence) ||
        !patterns[key].topic.test(evidence) || patterns[key].negative.test(text.replace(/不拥挤/g, '')))
      continue
    const context = clauses.find(clause => !speculative.test(clause) && clause.includes(evidence))
    if (context && !negation.test(context.slice(0, context.indexOf(evidence)))) labels[key] = evidence
  }
  return labels
}
