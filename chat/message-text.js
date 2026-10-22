// Keep the stored message unchanged; convert familiar shorthand only when displaying it.
export function displayMessage(value) {
  return String(value ?? '').replace(/(^|\s)<3(?=\s|$)/g, '$1❤️');
}
