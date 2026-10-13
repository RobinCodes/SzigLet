import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { detectBrowser, detectPlatform, installPrompt, useIsInstalled } from '../lib/platform'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
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

function Step({ n, children }: { n: number; children: ReactNode }) {
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
  const { t, tx } = useI18n()

  // Naming the real address is clearer than naming the app, especially when
  // somebody is following these steps on a second device.
  const host = typeof window === 'undefined' ? 'this page' : window.location.host
  const [guide, setGuide] = useState<Guide>(() => detectPlatform())
  const [promptReady, setPromptReady] = useState(installPrompt.available)
  const installed = useIsInstalled()
  const browser = detectBrowser()

  useEffect(() => installPrompt.subscribe(setPromptReady), [])

  const install = async () => {
    if (await installPrompt.show()) {
      toast.success(t('install.doneToast'))
    }
  }

  // The names of the bits of browser chrome being pointed at, as bold inline
  // fragments rather than three near-identical sentences per language.
  const chrome = {
    host: <strong>{host}</strong>,
    safari: <strong>Safari</strong>,
    chrome: <strong>Chrome</strong>,
    edge: <strong>Edge</strong>,
    dots: <strong>⋮</strong>,
    share: <strong>{t('install.shareWord')}</strong>,
    addToHome: <strong>{t('install.addToHomeWord')}</strong>,
    add: <strong>{t('install.addWord')}</strong>,
    install: <strong>{t('install.installWord')}</strong>,
    installApp: <strong>{t('install.installAppWord')}</strong>,
    editActions: <strong>{t('install.editActionsWord')}</strong>,
    private: <strong>{t('install.privateWord')}</strong>,
    bottomBar: <strong>{t('install.bottomBarWord')}</strong>,
    samsungPath: <strong>{t('install.samsungPathWord')}</strong>,
    installIcon: <strong>{t('install.installIconWord')}</strong>,
    path: <strong>{t('install.safariPathWord')}</strong>,
  }

  return (
    <Shell tabs={Boolean(user)}>
      <TopBar title={t('install.title')} back={user ? '/' : '/signin'} />

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
            <h2>{t('install.installedTitle')}</h2>
            <p className="muted small">{t('install.installedBody')}</p>
            {user && (
              <Link to="/" className="btn btn--primary" style={{ marginTop: '0.4rem' }}>
                {t('install.startStudying')}
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
                <h1 style={{ fontSize: '1.35rem' }}>{t('install.headline')}</h1>
                <p className="muted small" style={{ marginTop: '0.2rem' }}>
                  {t('install.sub')}
                </p>
              </div>
            </div>

            {promptReady && (
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={install}>
                <Icon name="install" />
                {t('install.now')}
              </button>
            )}

            <Segmented
              label={t('install.deviceLabel')}
              value={guide}
              onChange={setGuide}
              options={[
                { value: 'ios', label: t('install.ios') },
                { value: 'android', label: t('install.android') },
                { value: 'desktop', label: t('install.desktop') },
              ]}
            />

            {/* ── iOS ───────────────────────────────────────────────────── */}
            {guide === 'ios' && (
              <section className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                <p className="eyebrow">{t('install.iosHeading')}</p>

                {browser === 'firefox' && (
                  <div className="panel row" style={{ borderColor: 'var(--rehearse)' }}>
                    <Icon name="alert" style={{ color: 'var(--rehearse)', flex: 'none' }} />
                    <p className="small grow">{tx('install.iosFirefox', chrome)}</p>
                  </div>
                )}

                <ol className="steps">
                  <Step n={1}>{tx('install.iosStep1', chrome)}</Step>
                  <Step n={2}>
                    {tx('install.iosStep2', chrome)}
                    <PhoneFigure
                      highlight="bottom-share"
                      caption={t('install.iosStep2Caption')}
                    />
                  </Step>
                  <Step n={3}>
                    {tx('install.iosStep3', chrome)}
                    <MenuRowFigure
                      label={t('install.addToHomeLabel')}
                      caption={t('install.iosStep3Caption')}
                    />
                  </Step>
                  <Step n={4}>{tx('install.iosStep4', chrome)}</Step>
                </ol>

                <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                  <Icon name="sparkle" style={{ color: 'var(--accent)', flex: 'none' }} />
                  <p className="small grow">{tx('install.iosTip', chrome)}</p>
                </div>
              </section>
            )}

            {/* ── Android ───────────────────────────────────────────────── */}
            {guide === 'android' && (
              <section className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                <p className="eyebrow">{t('install.androidHeading')}</p>

                <ol className="steps">
                  <Step n={1}>{tx('install.androidStep1', chrome)}</Step>
                  <Step n={2}>
                    {tx('install.androidStep2', chrome)}
                    <PhoneFigure highlight="top-menu" caption={t('install.androidStep2Caption')} />
                  </Step>
                  <Step n={3}>
                    {tx('install.androidStep3', chrome)}
                    <MenuRowFigure
                      label={t('install.installAppLabel')}
                      caption={t('install.androidStep3Caption')}
                    />
                  </Step>
                  <Step n={4}>{tx('install.androidStep4', chrome)}</Step>
                </ol>

                <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                  <Icon name="sparkle" style={{ color: 'var(--accent)', flex: 'none' }} />
                  <p className="small grow">{tx('install.androidTip', chrome)}</p>
                </div>
              </section>
            )}

            {/* ── Desktop ───────────────────────────────────────────────── */}
            {guide === 'desktop' && (
              <section className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                <p className="eyebrow">{t('install.desktopHeading')}</p>

                <ol className="steps">
                  <Step n={1}>{tx('install.desktopStep1', chrome)}</Step>
                  <Step n={2}>
                    {tx('install.desktopStep2', chrome)}
                    <PhoneFigure highlight="address" caption={t('install.desktopStep2Caption')} />
                  </Step>
                  <Step n={3}>{tx('install.desktopStep3', chrome)}</Step>
                </ol>

                <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                  <Icon name="keyboard" style={{ color: 'var(--accent)', flex: 'none' }} />
                  <p className="small grow">
                    {tx('install.desktopKeys', {
                      left: <span className="kbd">←</span>,
                      right: <span className="kbd">→</span>,
                      space: <span className="kbd">Space</span>,
                      oneToFour: (
                        <>
                          <span className="kbd">1</span>–<span className="kbd">4</span>
                        </>
                      ),
                    })}
                  </p>
                </div>

                <p className="tiny faint">{tx('install.desktopSafari', chrome)}</p>
              </section>
            )}
          </>
        )}

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('install.whyBother')}</p>
          <div className="panel panel--flush">
            {[
              {
                icon: 'play' as const,
                title: t('install.whyInstant'),
                body: t('install.whyInstantBody'),
              },
              {
                icon: 'cloudOff' as const,
                title: t('install.whyOffline'),
                body: t('install.whyOfflineBody'),
              },
              {
                icon: 'cards' as const,
                title: t('install.whyFullScreen'),
                body: t('install.whyFullScreenBody'),
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
