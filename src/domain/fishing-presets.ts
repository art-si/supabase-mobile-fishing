const choices = (names: string[]) => names.map((name) => ({ id: name, name }))
export const fishSpeciesOptions = choices([
  '鲫鱼',
  '鲤鱼',
  '草鱼',
  '青鱼',
  '翘嘴',
  '鲢鳙',
  '鲈鱼',
  '黑鱼',
  '黄颡鱼',
  '鳊鱼',
  '白条',
  '鲮鱼',
  '罗非鱼',
  '鳜鱼',
  '马口',
  '鲶鱼'
])
export const fishingMethodOptions = choices([
  '台钓',
  '传统钓',
  '路亚',
  '海竿',
  '筏钓',
  '矶钓',
  '飞蝇钓',
  '冰钓'
])
export const fishingBaitOptions = choices([
  '蚯蚓',
  '红虫',
  '玉米',
  '麦粒',
  '颗粒饵',
  '商品饵',
  '拉饵',
  '搓饵',
  '活虾',
  '螺蛳',
  '蓝鲫',
  '九一八',
  '速攻',
  '螺鲤',
  '大板鲫',
  '米诺',
  '亮片',
  '软虫',
  '铅笔',
  '波爬'
])
export const fishingAdditiveOptions = choices([
  '果酸',
  '氨基酸',
  '甜菜碱',
  '虾油',
  '红薯膏',
  '玉米香精',
  '蜂蜜',
  '黑糖',
  '药酒'
])
export const experienceTopicOptions = choices([
  '钓法技巧',
  '饵料搭配',
  '钓位选择',
  '装备心得',
  '鱼情观察',
  '出钓见闻'
])
export function currentChinaTime(now = new Date()) {
  // Fishing timestamps use +08:00. Mini Program JS engines can lack Intl;
  // draft creation runs before the first render and must not depend on it.
  if (!Number.isFinite(now.getTime())) return ''
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return `${String(china.getUTCHours()).padStart(2, '0')}:${String(china.getUTCMinutes()).padStart(2, '0')}`
}
export function fishingDateTime(date: string, time = '') {
  if (!time) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  return `${date}T${time}:00+08:00`
}
