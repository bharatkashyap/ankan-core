export function renameTripPerson(from: string, to: string) {
  const replace = (person: string) => person === from || person.toLowerCase() === to.toLowerCase() ? to : person;
  const names = (people: string[]) => [...new Set(people.map(replace))];
  return { replace, names };
}
