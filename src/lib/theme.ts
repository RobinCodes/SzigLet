export type Theme = 'system' | 'light' | 'dark'

const KEY = 'sziglet.theme'

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') {
    delete root.dataset.theme
  } else {
    root.dataset.theme = theme
  }
  try {
    if (theme === 'system') {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, theme)
    }
  } catch {
    /* storage blocked */
  }

  // Keep the browser chrome in step with the app background.
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.content = dark ? '#0a0b0e' : '#f7f7f9'
    })
}
