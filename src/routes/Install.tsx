import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { detectBrowser, detectPlatform, installPrompt, isInstalled } from '../lib/platform'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { Shell, TopBar } from '../components/Shell'
import { Segmented } from '../components/Bits'
import { Icon, Logo } from '../components/Icon'

type Guide = 'ios' | 'android' | 'desktop'

/** A phone outline with one piece of chrome highlighted. */
function PhoneFigure({
  highlight,
  caption,
}: {
  highlight: 'bottom-share' | 'top-share' | 'top-menu' | 'address'
  caption: string
}) {
  const ring = 'var(--accent)'
  return (
    <div className="step__figure">
      <svg viewBox="50 -4 120 140" role="img" aria-label={caption}>
        <rect
          x="60"
          y="6"
          width="100"
          height="120"
          rx="12"
          fill="var(--surface)"
          stroke="var(--line-strong)"
          strokeWidth="1.5"
        />
        {/* Address bar */}
        <rect
          x="68"
          y={highlight === 'bottom-share' ? 14 : 14}
          width="84"
          height="12"
          rx="6"
          fill="var(--surface-3)"
        />
        <rect x="74" y="18" width="40" height="4" rx="2" fill="var(--ink-faint)" opacity="0.6" />

        {/* Page content */}
        <rect x="68" y="34" width="84" height="6" rx="3" fill="var(--surface-3)" />
        <rect x="68" y="46" width="60" height="6" rx="3" fill="var(--surface-3)" />
        <rect x="68" y="58" width="72" height="6" rx="3" fill="var(--surface-3)" />

        {/* Bottom toolbar, Safari on iOS */}
        {highlight === 'bottom-share' && (
          <>
            <rect x="68" y="104" width="84" height="16" rx="8" fill="var(--surface-2)" />
            <g stroke="var(--ink-faint)" strokeWidth="1.4" strokeLinecap="round" fill="none">
              <path d="M76 112h5M86 112h5" />
            </g>
            {/* The share glyph */}
            <g transform="translate(106 106)">
              <circle cx="6" cy="6" r="11" fill="var(--accent-dim)" stroke={ring} strokeWidth="1.6" />
              <path
                d="M6 9V2m0 0L3.6 4.4M6 2l2.4 2.4M2 7.5V10h8V7.5"
                stroke={ring}
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
            <g stroke="var(--ink-faint)" strokeWidth="1.4" strokeLinecap="round" fill="none">
              <path d="M130 112h5M140 112h5" />
            </g>
          </>
        )}

        {/* Share glyph in the address bar, Chrome on iOS */}
        {highlight === 'top-share' && (
          <g transform="translate(136 12)">
            <circle cx="7" cy="7" r="10" fill="var(--accent-dim)" stroke={ring} strokeWidth="1.6" />
            <path
              d="M7 10.5V3.5m0 0L4.8 5.7M7 3.5l2.2 2.2M3.2 8.5V11h7.6V8.5"
              stroke={ring}
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        )}

        {/* Three-dot menu, Chrome on Android */}
        {highlight === 'top-menu' && (
          <g transform="translate(140 12)">
            <circle cx="7" cy="7" r="10" fill="var(--accent-dim)" stroke={ring} strokeWidth="1.6" />
            <g fill={ring}>
              <circle cx="7" cy="3.4" r="1.3" />
              <circle cx="7" cy="7" r="1.3" />
              <circle cx="7" cy="10.6" r="1.3" />
            </g>
          </g>
        )}

        {/* Install icon inside the address bar, desktop */}
        {highlight === 'address' && (
          <g transform="translate(132 12)">
            <circle cx="8" cy="7" r="10" fill="var(--accent-dim)" stroke={ring} strokeWidth="1.6" />
            <path
              d="M8 2.5v7m0 0 2.2-2.2M8 9.5 5.8 7.3M4 11h8"
              stroke={ring}
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        )}
      </svg>
    </div>
  )
}

/** The "Add to Home Screen" row as it appears in a share sheet. */
function MenuRowFigure({ label, caption }: { label: string; caption: string }) {
  return (
    <div className="step__figure">
      <svg viewBox="0 0 220 76" role="img" aria-label={caption}>
        <rect x="14" y="6" width="192" height="64" rx="10" fill="var(--surface-2)" />
        <rect x="24" y="14" width="80" height="5" rx="2.5" fill="var(--ink-faint)" opacity="0.45" />
        <rect
          x="20"
          y="28"
          width="180"
          height="26"
          rx="7"
          fill="var(--accent-dim)"
          stroke="var(--accent)"
          strokeWidth="1.4"
        />
        <g transform="translate(29 34)">
          <rect
            x="0"
            y="0"
            width="14"
            height="14"
            rx="3.5"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.4"
          />
          <path d="M7 4v6M4 7h6" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" />
        </g>
        <text
          x="52"
          y="45"
          fill="var(--accent)"
          fontSize="10"
          fontWeight="650"
          style={{ fontFamily: 'var(--font)' }}
        >
          {label}
        </text>
        <rect x="24" y="60" width="120" height="4" rx="2" fill="var(--ink-faint)" opacity="0.3" />
      </svg>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="step">
      <span className="step__num">{n}</span>
      <div className="step__body">{children}</div>
    </li>
  )
}

export function Install() {
  const { user } = useAuth()
  const toast = useToast()

  // Naming the real address is clearer than naming the app, especially when
  // somebody is following these steps on a second device.
  const host = typeof window === 'undefined' ? 'this page' : window.location.host
  const [guide, setGuide] = useState<Guide>(() => detectPlatform())
  const [promptReady, setPromptReady] = useState(installPrompt.available)
  const [installed, setInstalled] = useState(isInstalled())
  const browser = detectBrowser()

  useEffect(() => installPrompt.subscribe(setPromptReady), [])

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)')
    const onChange = () => setInstalled(isInstalled())
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const install = async () => {
    const accepted = await installPrompt.show()
    if (accepted) {
      toast.success('SzigLet is on your home screen.')
      setInstalled(true)
    }
  }

  return (
    <Shell tabs={Boolean(user)}>
      <TopBar title="Install SzigLet" back={user ? '/' : '/signin'} />

      <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
        {installed ? (
          <div
            className="panel stack center"
            style={{
              '--gap': '0.6rem',
              alignItems: 'center',
              borderColor: 'var(--known)',
              padding: '1.75rem 1rem',
            } as React.CSSProperties}
          >
            <div style={{ color: 'var(--known)' }}>
              <Icon name="check" width={34} height={34} />
            </div>
            <h2>Already installed</h2>
            <p className="muted small">
              You are running SzigLet as an app. It opens from your home screen, fills the
              whole screen and keeps your library available offline.
            </p>
            {user && (
              <Link to="/" className="btn btn--primary" style={{ marginTop: '0.4rem' }}>
                Start studying
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="row" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: '3.25rem',
                  height: '3.25rem',
                  flex: 'none',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  color: 'var(--accent)',
                }}
              >
                <Logo size={30} />
              </div>
              <div className="grow">
                <h1 style={{ fontSize: '1.35rem' }}>Put SzigLet on your home screen</h1>
                <p className="muted small" style={{ marginTop: '0.2rem' }}>
                  No app store, no download. It becomes a real app icon in about ten seconds.
                </p>
              </div>
            </div>

            {promptReady && (
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={install}>
                <Icon name="install" />
                Install now
              </button>
            )}

            <Segmented
              label="Choose your device"
              value={guide}
              onChange={setGuide}
              options={[
                { value: 'ios', label: 'iPhone / iPad' },
                { value: 'android', label: 'Android' },
                { value: 'desktop', label: 'Computer' },
              ]}
            />

            {/* ── iOS ───────────────────────────────────────────────────── */}
            {guide === 'ios' && (
              <section className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                <p className="eyebrow">iPhone and iPad</p>

                {browser === 'firefox' && (
                  <div className="panel row" style={{ borderColor: 'var(--rehearse)' }}>
                    <Icon name="alert" style={{ color: 'var(--rehearse)', flex: 'none' }} />
                    <p className="small grow">
                      Firefox on iOS cannot add apps to the home screen. Open this page in{' '}
                      <strong>Safari</strong> first.
                    </p>
                  </div>
                )}

                <ol className="steps">
                  <Step n={1}>
                    Open <strong>{host}</strong> in <strong>Safari</strong>. Chrome works
                    too on recent iOS versions, but Safari is the sure thing.
                  </Step>
                  <Step n={2}>
                    Tap the <strong>Share</strong> button — the square with an arrow pointing
                    up. In Safari it sits in the <strong>bar at the bottom</strong> of the
                    screen; in Chrome it is next to the address bar at the top.
                    <PhoneFigure
                      highlight="bottom-share"
                      caption="The share button in the Safari toolbar at the bottom of the screen"
                    />
                  </Step>
                  <Step n={3}>
                    Scroll down the grey list of actions and tap{' '}
                    <strong>Add to Home Screen</strong>.
                    <MenuRowFigure
                      label="Add to Home Screen"
                      caption="The Add to Home Screen row in the iOS share sheet"
                    />
                  </Step>
                  <Step n={4}>
                    Tap <strong>Add</strong> in the top right. The SzigLet icon appears on
                    your home screen.
                  </Step>
                </ol>

                <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                  <Icon name="sparkle" style={{ color: 'var(--accent)', flex: 'none' }} />
                  <p className="small grow">
                    Can't find <em>Add to Home Screen</em>? Swipe the bottom row of the share
                    sheet to the left and tap <strong>Edit Actions</strong> to pin it, or make
                    sure you are not in a <strong>Private</strong> tab — iOS hides the option
                    there.
                  </p>
                </div>
              </section>
            )}

            {/* ── Android ───────────────────────────────────────────────── */}
            {guide === 'android' && (
              <section className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                <p className="eyebrow">Android</p>

                <ol className="steps">
                  <Step n={1}>
                    Open <strong>{host}</strong> in <strong>Chrome</strong> (or Samsung
                    Internet, or Firefox — all three can do this).
                  </Step>
                  <Step n={2}>
                    Tap the <strong>⋮</strong> menu in the top right corner.
                    <PhoneFigure
                      highlight="top-menu"
                      caption="The three-dot menu in the top right corner of Chrome"
                    />
                  </Step>
                  <Step n={3}>
                    Choose <strong>Add to Home screen</strong> — newer Chrome versions call it{' '}
                    <strong>Install app</strong>, and Samsung Internet puts it under{' '}
                    <strong>Add page to → Home screen</strong>.
                    <MenuRowFigure
                      label="Install app"
                      caption="The Install app row in the Chrome menu"
                    />
                  </Step>
                  <Step n={4}>
                    Confirm with <strong>Install</strong> or <strong>Add</strong>. SzigLet
                    lands in your app drawer and on your home screen.
                  </Step>
                </ol>

                <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                  <Icon name="sparkle" style={{ color: 'var(--accent)', flex: 'none' }} />
                  <p className="small grow">
                    Chrome often shows an <strong>Install</strong> banner by itself. If you see
                    it, that is the same thing — one tap and you are done.
                  </p>
                </div>
              </section>
            )}

            {/* ── Desktop ───────────────────────────────────────────────── */}
            {guide === 'desktop' && (
              <section className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                <p className="eyebrow">Windows, macOS and Linux</p>

                <ol className="steps">
                  <Step n={1}>
                    Open SzigLet in <strong>Chrome</strong> or <strong>Edge</strong>.
                  </Step>
                  <Step n={2}>
                    Click the <strong>install icon</strong> in the address bar — a small screen
                    with a downward arrow, on the right-hand side.
                    <PhoneFigure
                      highlight="address"
                      caption="The install icon at the right of the address bar"
                    />
                  </Step>
                  <Step n={3}>
                    Click <strong>Install</strong>. SzigLet opens in its own window, without
                    tabs, and you can pin it to your taskbar or dock.
                  </Step>
                </ol>

                <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                  <Icon name="keyboard" style={{ color: 'var(--accent)', flex: 'none' }} />
                  <p className="small grow">
                    On a laptop the flashcards take keyboard shortcuts:{' '}
                    <span className="kbd">←</span> to rehearse, <span className="kbd">→</span>{' '}
                    for known, <span className="kbd">Space</span> to flip. In a multiple
                    choice test, <span className="kbd">1</span>–<span className="kbd">4</span>{' '}
                    pick an answer.
                  </p>
                </div>

                <p className="tiny faint">
                  Safari on macOS can do this too: <strong>File → Add to Dock</strong>.
                </p>
              </section>
            )}
          </>
        )}

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">Why bother</p>
          <div className="panel panel--flush">
            {[
              {
                icon: 'play' as const,
                title: 'Opens instantly',
                body: 'No address bar, no browser tabs — it starts straight on your library.',
              },
              {
                icon: 'cloudOff' as const,
                title: 'Works without signal',
                body: 'Sets you have opened stay readable, and your swipes sync when you are back online.',
              },
              {
                icon: 'cards' as const,
                title: 'Full screen cards',
                body: 'The swipe deck gets the whole display, which is how it is meant to be used.',
              },
            ].map((item) => (
              <div className="cardrow" key={item.title} style={{ alignItems: 'flex-start' }}>
                <Icon
                  name={item.icon}
                  style={{ color: 'var(--accent)', flex: 'none', marginTop: '0.15rem' }}
                />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                  <div className="small muted">{item.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  )
}
