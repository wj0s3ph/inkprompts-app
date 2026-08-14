export function firstDayForLocale(language: string): 0 | 1 {
  const locale = new Intl.Locale(language) as Intl.Locale & {
    weekInfo?: { firstDay: number }
    getWeekInfo?: () => { firstDay: number }
  }
  const firstDay = locale.weekInfo?.firstDay ?? locale.getWeekInfo?.().firstDay
  return firstDay === 7 ? 0 : 1
}
