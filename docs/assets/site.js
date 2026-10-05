const THEME_KEY = 'tp-docs-theme'
const root = document.documentElement
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

const currentTheme = () => root.dataset.theme ?? (darkQuery.matches ? 'dark' : 'light')

const toggle = document.querySelector('.theme-toggle')
if (toggle) toggle.hidden = false
const syncToggle = () => {
  if (!toggle) return
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  toggle.setAttribute('aria-label', `Switch to ${next} theme`)
  toggle.setAttribute('title', `Switch to ${next} theme`)
}

toggle?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  root.dataset.theme = next
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {}
  syncToggle()
})
darkQuery.addEventListener('change', syncToggle)
syncToggle()

const lightbox = document.querySelector('.lightbox')
let lightboxImage = null
for (const button of document.querySelectorAll('.zoom')) {
  button.addEventListener('click', () => {
    const image = button.querySelector('img')
    if (!lightbox || !image) return
    if (!lightboxImage) lightboxImage = lightbox.appendChild(document.createElement('img'))
    lightboxImage.src = image.currentSrc || image.src
    lightboxImage.alt = image.alt
    lightbox.showModal()
  })
}
lightbox?.addEventListener('click', () => lightbox.close())

const tocLinks = [...document.querySelectorAll('.toc a')]
const sections = tocLinks
  .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
  .filter((section) => section !== null)

if (sections.length > 0) {
  let frame = 0
  const highlight = () => {
    frame = 0
    const line = 120
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
    const current = atBottom
      ? sections[sections.length - 1]
      : sections.filter((section) => section.getBoundingClientRect().top <= line).pop() ?? sections[0]
    for (const link of tocLinks) link.classList.toggle('active', link.hash === `#${current.id}`)
  }
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(highlight)
  }
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  highlight()
}
