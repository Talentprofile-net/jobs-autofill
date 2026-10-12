const NAME = /\bnames?\b/i

const PREFERRED = /\bprefer(s|red)?\b/i

const GOES_BY = /\b(go(es)?|known|called|addressed) by\b/i

const CONDITIONAL = /\b(if|when|where)\b[^.?!]*\b(differ\w*|different|other than|not the same)\b/i

const ALTERNATE_NAME =
  /\b(nick ?names?|alias(es)?|a\.?k\.?a\.?|also known as|(maiden|former|previous|prior|other|alternate|alternative|chosen)( (first|last|given|family|full|legal))? names?)\b/i

const ADDRESS_AS = /\b(call|address) you\b|\bnames? (that )?you('d| would) like (us )?to use\b|\bnames? (that )?you (want|like) (us )?to use\b/i

export const isAlternateIdentityQuestion = (text: string): boolean => {
  const flat = text.replace(/[\s_]+/g, ' ')
  if (ALTERNATE_NAME.test(flat) || ADDRESS_AS.test(flat)) return true
  return NAME.test(flat) && (PREFERRED.test(flat) || GOES_BY.test(flat) || CONDITIONAL.test(flat))
}
