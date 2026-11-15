/** UW enroll calls both terms by the academic year. Display the calendar year of the semester. */
export function displayTerm(label: string): string {
  const year = /^(Fall|Spring|Summer) (\d{4})[-–](\d{4})$/i.exec(label);
  return year ? `${year[1]} ${year[1].toLowerCase() === 'fall' ? year[2] : year[3]}` : label;
}
