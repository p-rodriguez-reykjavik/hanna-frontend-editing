import React, { useEffect, useMemo, useRef, useState } from 'react';
import focusElm from '@hugsmidjan/qj/focusElm';
import useShortState from '@hugsmidjan/react/hooks/useShortState';
import getBemClass from '@hugsmidjan/react/utils/getBemClass';
import { getPageScrollElm } from '@reykjavik/hanna-utils';
import { DefaultTexts, getTexts } from '@reykjavik/hanna-utils/i18n';

import { Link } from './_abstract/_Link';
import {
  AuxilaryPanelIllustration,
  AuxiliaryPanel,
  AuxiliaryPanelProps,
} from './MainMenu/_Auxiliary';
import { PrimaryPanel } from './MainMenu/_PrimaryPanel';
import { useHannaUIState } from './utils/HannaUIState';
import { useFormatMonitor } from './utils/useFormatMonitor';
import { SSRSupport, useIsBrowserSide } from './utils';

const findActivePanel = (megaPanels: ReadonlyArray<MegaMenuPanel>, activeId?: string) =>
  activeId ? megaPanels.find((panel) => activeId === panel.id) : undefined;

// ---------------------------------------------------------------------------

export type MainMenuI18n = {
  lang?: string;
  backToMenu: string;
  backToMenuLong?: string;
};

export const defaultMainMenuTexts: DefaultTexts<MainMenuI18n> = {
  is: { lang: 'is', backToMenu: 'Loka', backToMenuLong: 'Til baka í valmynd' },
  en: { lang: 'en', backToMenu: 'Close', backToMenuLong: 'Close and return to menu' },
};

// ---------------------------------------------------------------------------

export type { AuxilaryPanelIllustration, AuxiliaryPanelProps };

export type MainMenuItem = {
  label: string;
  labelLong?: string;
  lang?: string;
  modifier?: string;
  current?: boolean;
  href?: string;
  /**
   * Adding `onClick` automatically results in a <button/> element being rendered.
   *
   * NOTE: Clicking a MainMenu item will automatically close HannaUIState's
   * "Hamburger menu" (a.k.a. "Mobile menu")
   * … unless the `onClick` function explicitly returns `false`.
   */
  onClick?: (index: number, item: MainMenuItem) => undefined | boolean;
  controlsId?: string;
};
export type MainMenuSeparator = '---';
export type MainMenuItemList = Array<MainMenuItem | MainMenuSeparator>;

export type MegaMenuItem = {
  label: string;
  summary?: string;
  href: string;
  lang?: string;
  current?: boolean;
  target?: string;
};

export type MegaMenuPanel = {
  title: string;
  items: Array<MegaMenuItem>;
  id: string;
};

export type MainMenuProps = {
  title: string;
  items: MainMenuItemList;
  megaPanels?: Array<MegaMenuPanel>;
  auxiliaryPanel?: AuxiliaryPanelProps;
  /**
   * NOTE: Clicking a MainMenu item will automatically close HannaUIState's
   * "Hamburger menu" (a.k.a. "Mobile menu")
   * … unless the `onItemClick` function explicitly returns `false`.
   */
  onItemClick?: (index: number, item: MainMenuItem) => undefined | boolean;
  activePanelId?: string;
  texts?: MainMenuI18n;
  lang?: string;
  ssr?: SSRSupport;
};

export const MainMenu = (props: MainMenuProps) => {
  const { title, megaPanels = [], onItemClick, ssr, auxiliaryPanel } = props;

  const { closeHamburgerMenu } = useHannaUIState();

  const isBrowser = useIsBrowserSide(ssr);

  const menuElmRef = useRef<HTMLElement>(null);
  const pressedLinkRef = useRef<HTMLButtonElement>(null);
  const activePanelRef = useRef<HTMLLIElement>(null);

  const [activePanel, _setActivePanel] = useState<MegaMenuPanel | undefined>(
    () => isBrowser && findActivePanel(megaPanels, props.activePanelId)
  );
  const [laggyActivePanel, setLaggyActivePanel] = useShortState<
    MegaMenuPanel | undefined
  >();

  const setActivePanel = useMemo(
    () =>
      isBrowser
        ? (newActive: MegaMenuPanel | undefined, setFocus = true) => {
            const htmlElmDataset = document.documentElement.dataset;

            // const menuElm = menuElmRef.current as HTMLElement;
            _setActivePanel((activePanel) => {
              const scrollElm = getPageScrollElm();
              if (!newActive) {
                activePanel && setLaggyActivePanel(activePanel, 1000);
                scrollElm.scrollTop = parseInt(htmlElmDataset.scrollTop || '') || 0;
                delete htmlElmDataset.scrollTop;
                delete htmlElmDataset.megaPanelActive;
              } else {
                setLaggyActivePanel(undefined, 0);
                htmlElmDataset.scrollTop = String(scrollElm.scrollTop);
                scrollElm.scrollTop = 0;
                htmlElmDataset.megaPanelActive = '';
              }

              if (setFocus) {
                const pressedLinkElm = pressedLinkRef.current; // pressedLinkElm will be undefined when setTimeout fires
                setTimeout(() => {
                  if (!newActive) {
                    // const buttonElm = menuElm.querySelector<HTMLButtonElement>(
                    // 	'button.MainMenu__link[aria-pressed="true"]'
                    // );
                    focusElm(pressedLinkElm);
                  } else if (newActive !== activePanel) {
                    // const panelElm = menuElm.querySelector<HTMLButtonElement>(
                    // 	'.PrimaryPanel--active'
                    // );
                    focusElm(activePanelRef.current);
                  }
                }, 100);
              }
              return newActive;
            });
          }
        : () => undefined,
    [setLaggyActivePanel, isBrowser]
  );

  useFormatMonitor((media) => {
    if (media.leftTopmenu) {
      setActivePanel(undefined);
    }
  });

  const hasActivePanel = !!activePanel;

  const menuItems = useMemo(
    () =>
      props.items.map((item) => {
        if (item === '---') {
          return item;
        }
        const href = item.href;
        const controlsId =
          item.controlsId || (href && /^#/.test(href) && href.slice(1)) || undefined;
        return {
          ...item,
          controlsId,
          megaPanel: controlsId && megaPanels.find((panel) => panel.id === controlsId),
        };
      }),
    [props.items, megaPanels]
  );

  useEffect(() => {
    setActivePanel(findActivePanel(megaPanels, props.activePanelId));
  }, [props.activePanelId, megaPanels, setActivePanel]);

  useEffect(() => {
    const menuElm = menuElmRef.current;
    if (!isBrowser || !hasActivePanel || !menuElm) {
      return;
    }

    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePanel(undefined);
      }
    };
    const clickHandler = (e: MouseEvent) => {
      if (!menuElm.contains(e.target as HTMLElement | null)) {
        setActivePanel(undefined);
      }
    };
    document.addEventListener('keydown', escHandler);
    document.addEventListener('click', clickHandler, true);

    return () => {
      document.removeEventListener('keydown', escHandler);
      document.removeEventListener('click', clickHandler, true);
    };
  }, [hasActivePanel, setActivePanel, isBrowser]);

  if (menuItems.length === 0) {
    return null;
  }

  /** Close mega panels on clicks their links. */
  const handleMegaPanelClicks = (e: React.MouseEvent<HTMLElement>) => {
    if (
      // NOTE: We can NOT check for `e.defaultPrevented` because if the current
      // LinkRenderer is something like Next.js or Remix's <Link/> compponent
      // then default is ALWAYS prevented
      (e.target as HTMLElement).closest('a[href]')
    ) {
      setActivePanel(undefined);
      closeHamburgerMenu();
    }
  };

  return (
    <nav
      className="MainMenu"
      aria-label={title}
      data-sprinkled={isBrowser}
      ref={menuElmRef}
    >
      <h2 className="MainMenu__title">{title}</h2>
      <ul className="MainMenu__items">
        {menuItems.map((item, i) => {
          if (item === '---') {
            return <li key={i} className="MainMenu__separator" aria-hidden="true" />;
          }

          const { label, labelLong, lang, controlsId, onClick } = item;
          const pressed = (activePanel && controlsId === activePanel.id) || undefined;
          return (
            <li
              key={i}
              className={getBemClass('MainMenu__item', item.modifier)}
              aria-current={item.current || undefined}
            >
              {
                onClick || (!!item.megaPanel && (isBrowser || !item.href)) ? (
                  // only print script-driven buttons in the browser
                  <button
                    className="MainMenu__link"
                    onClick={() => {
                      const keepOpen1 = onClick && onClick(i, item) === false;
                      const keepOpen2 = onItemClick && onItemClick(i, item) === false;
                      const { megaPanel } = item;
                      if (megaPanel) {
                        setActivePanel(megaPanel !== activePanel ? megaPanel : undefined);
                      } else {
                        !(keepOpen1 || keepOpen2) && closeHamburgerMenu();
                      }
                    }}
                    ref={pressed && pressedLinkRef}
                    aria-pressed={pressed}
                    aria-controls={controlsId}
                    aria-label={labelLong}
                    title={labelLong} // For auto-tooltips on desktop
                    lang={lang}
                    type="button"
                  >
                    {label}
                  </button>
                ) : item.href != null ? (
                  // always render links server-side
                  <Link
                    className="MainMenu__link"
                    href={item.href}
                    aria-label={labelLong}
                    title={labelLong} // For auto-tooltips on desktop
                    onClick={() => {
                      const keepOpen = onItemClick && onItemClick(i, item) === false;
                      !keepOpen && closeHamburgerMenu();
                    }}
                    lang={lang}
                  >
                    {label}
                  </Link>
                ) : undefined // skip rendering non-link menu items server side
              }
            </li>
          );
        })}
      </ul>
      {'\n\n'}
      {megaPanels.length > 0 && (
        <div className={getBemClass('MainMenu__panelsWrap', [activePanel && 'active'])}>
          <ul className="MainMenu__panels" onClick={handleMegaPanelClicks}>
            {megaPanels.map((panel, i) => {
              if (!panel.items.length) {
                return;
              }
              const isActive =
                activePanel === panel || laggyActivePanel === panel || undefined;
              const isParent = !!panel.items.find((item) => item.current);

              return (
                <PrimaryPanel
                  key={i}
                  isParent={isParent}
                  isActive={isActive}
                  panel={panel}
                  isBrowser={isBrowser}
                  setActivePanel={setActivePanel}
                  texts={getTexts(props, defaultMainMenuTexts)}
                  activeRef={activePanelRef}
                />
              );
            })}
            {auxiliaryPanel && <AuxiliaryPanel {...auxiliaryPanel} />}
          </ul>
        </div>
      )}
    </nav>
  );
};

export default MainMenu;
