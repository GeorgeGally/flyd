export function fiveWorkingDayWindowStart(now: Date): Date {
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  let workingDays = 0;
  while (workingDays < 5) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) workingDays += 1;
    if (workingDays < 5) cursor.setDate(cursor.getDate() - 1);
  }
  return cursor;
}
