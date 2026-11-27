/** Public news columns. Regional sources infer the city from the original article, never the provincial capital. */
export const spotPublicIndexes = [
  { city: '武汉市', url: 'https://nyncj.wuhan.gov.cn/xwzx_25/whsn/' },
  { city: '武汉市', url: 'https://hbj.wuhan.gov.cn/hjxw/' },
  { city: '武汉市', url: 'https://www.whkfq.gov.cn/xwzx/yw/kfqyw/qnxw/' },
  { city: '上海市', url: 'https://nyncw.sh.gov.cn/mtbd/' },
  { city: '江门市', url: 'https://www.jiangmen.gov.cn/bmpd/jmswhgdlytyj/ztzl/lyzx/cytj/' },
  { city: '北京市', url: 'https://nyncj.beijing.gov.cn/nyj/snxx/' },
  ...[
    ['ah', '安徽省'], ['bj', '北京市'], ['cq', '重庆市'], ['fj', '福建省'], ['gs', '甘肃省'],
    ['gz', '贵州省'], ['gd', '广东省'], ['gx', '广西壮族自治区'], ['hi', '海南省'], ['heb', '河北省'],
    ['ha', '河南省'], ['hb', '湖北省'], ['hn', '湖南省'], ['hlj', '黑龙江省'], ['js', '江苏省'],
    ['jx', '江西省'], ['jl', '吉林省'], ['ln', '辽宁省'], ['nmg', '内蒙古自治区'], ['nx', '宁夏回族自治区'],
    ['qh', '青海省'], ['sd', '山东省'], ['sx', '山西省'], ['shx', '陕西省'], ['sh', '上海市'],
    ['sc', '四川省'], ['tj', '天津市'], ['xj', '新疆维吾尔自治区'], ['bt', '新疆维吾尔自治区'],
    ['yn', '云南省'], ['zj', '浙江省']
  ].map(([host, region]) => ({ city: '', region, url: `https://www.${host}.chinanews.com.cn/` }))
] as const
