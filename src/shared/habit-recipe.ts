export function formatHabitRecipeSentence(anchor: string): string {
  return `After ${/^I\b/i.test(anchor) ? anchor : `I ${anchor}`}, I will write one honest sentence.`
}
