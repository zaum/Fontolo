import { open, save } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  DatabaseBackup,
  FolderDown,
  FolderOpen,
  FolderPlus,
  Languages,
  Library,
  Link2,
  MessageSquarePlus,
  Palette,
  SunMoon,
  Trash2,
  Volume2,
  X,
  Globe2,
  RefreshCw,
  Keyboard,
} from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PillToggle } from "../design/primitives/PillToggle";
import { ACCENT_PRESETS, DEFAULT_ACCENT } from "../lib/accent";
import { springSoft } from "../design/springs";
import { ipc } from "../lib/ipc";
import { formatBytes } from "../lib/fontLoader";
import { useFontStore } from "../state/fontStore";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useT } from "../lib/i18n";
import type { TKey } from "../lib/i18n";
import { LanguageSelect } from "./LanguageSelect";
import { ShortcutsContent } from "./ShortcutsContent";
import { APP_LICENSE, APP_VERSION } from "../lib/version";
import type { SettingsCategoryId } from "../state/fontStore";

const REQUEST_LANGUAGE_URL =
  "https://github.com/zaum/fontolo/issues/new?title=Language%20request%3A%20";

const CATEGORIES: { id: SettingsCategoryId; icon: typeof Languages }[] = [
  { id: "language", icon: Languages },
  { id: "library", icon: Library },
  { id: "googleFonts", icon: Globe2 },
  { id: "autoActivation", icon: Link2 },
  { id: "appearance", icon: Palette },
  { id: "shortcuts", icon: Keyboard },
];

function categoryTitleKey(id: SettingsCategoryId): TKey {
  switch (id) {
    case "language":
      return "settings.language";
    case "library":
      return "settings.library";
    case "googleFonts":
      return "settings.googleFonts";
    case "autoActivation":
      return "settings.autoActivation";
    case "appearance":
      return "settings.appearance";
    case "shortcuts":
      return "settings.shortcuts";
  }
}

function ScanProgressText() {
  const t = useT();
  const progress = useFontStore((s) => s.scanProgress);
  return (
    <>
      {progress.total > 0
        ? t("scan.reading", { done: progress.done, total: progress.total })
        : t("settings.scanningFolders")}
    </>
  );
}

export function SettingsOverlay() {
  const t = useT();
  const openState = useFontStore((s) => s.settingsOpen);
  const setSettingsOpen = useFontStore((s) => s.setSettingsOpen);
  const activeCategory = useFontStore((s) => s.settingsCategory);
  const setSettingsCategory = useFontStore((s) => s.setSettingsCategory);
  const settings = useFontStore((s) => s.settings);
  const updateSettings = useFontStore((s) => s.updateSettings);
  const soundPref = useFontStore((s) => s.soundPref);
  const setSoundPref = useFontStore((s) => s.setSoundPref);
  const themePref = useFontStore((s) => s.themePref);
  const setThemePref = useFontStore((s) => s.setThemePref);
  const accent = useFontStore((s) => s.accent);
  const setAccent = useFontStore((s) => s.setAccent);
  const scanning = useFontStore((s) => s.phase === "scanning");
  const googleFontsProgress = useFontStore((s) => s.googleFontsProgress);
  const trapRef = useFocusTrap<HTMLDivElement>(openState);
  const [defaultLibDir, setDefaultLibDir] = useState("");
  const affinityConnection = useFontStore((s) => s.affinityConnection);
  const refreshAffinityConnection = useFontStore((s) => s.refreshAffinityConnection);

  const googleCacheBytes = useFontStore((s) => s.googleCacheBytes);
  const refreshGoogleCacheSize = useFontStore((s) => s.refreshGoogleCacheSize);
  const clearGoogleCache = useFontStore((s) => s.clearGoogleCache);
  const [googleInstallDir, setGoogleInstallDir] = useState("");

  useEffect(() => {
    if (!openState) return;
    void ipc.defaultLibraryDir().then(setGoogleInstallDir).catch(() => {});
  }, [openState]);

  // Metadata only: a refresh checks the catalogue for new families, it does not
  // download a single font file.
  const refreshCatalog = () => {
    void useFontStore.getState().refreshGoogleCatalog();
  };

  useEffect(() => {
    if (!openState) return;
    void refreshGoogleCacheSize();
    void refreshAffinityConnection();
  }, [openState, refreshAffinityConnection, refreshGoogleCacheSize]);

  useEffect(() => {
    if (!openState || defaultLibDir) return;
    void ipc.defaultLibraryDir().then(setDefaultLibDir).catch(() => {});
  }, [openState, defaultLibDir]);

  useEffect(() => {
    if (!openState) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSettingsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openState, setSettingsOpen]);

  const addFolder = async () => {
    const dir = await open({ directory: true, title: t("settings.addFolderTitle") });
    if (!dir || settings.extraDirs.includes(dir)) return;
    void updateSettings({ ...settings, extraDirs: [...settings.extraDirs, dir] });
  };

  const pickLibraryDir = async () => {
    const dir = await open({ directory: true, title: t("settings.libraryFolderTitle") });
    if (!dir) return;
    // Picking a folder turns the custom folder on.
    void updateSettings({ ...settings, libraryDir: dir, libraryDirEnabled: true });
  };

  const setCustomDirEnabled = (on: boolean) => {
    if (on === settings.libraryDirEnabled) return;
    // The path is kept while disabled, so re-enabling restores it as-is.
    void updateSettings({ ...settings, libraryDirEnabled: on });
  };

  // The custom folder is in effect only when enabled with a folder picked.
  const customDirActive = settings.libraryDirEnabled && settings.libraryDir != null;

  // A reachable server can still be unable to serve its SDK documentation (the
  // preamble comes from Affinity's online hint pool), so a reachable connection
  // with an error is reported as online *with* that error, not as a lost link.
  const affinityDetail = !affinityConnection
    ? t("settings.affinityChecking")
    : affinityConnection.reachable
      ? affinityConnection.error
        ? `${t("settings.affinityOnline")} · ${affinityConnection.error}`
        : `${t("settings.affinityOnline")}${affinityConnection.version ? ` · ${affinityConnection.version}` : ""} · ${t("settings.affinityDocs", { count: affinityConnection.docCount })}`
      : (affinityConnection.error
          ? `${t("settings.affinityOffline")} · ${affinityConnection.error}`
          : t("settings.affinityOffline"));
  const affinityDot = !affinityConnection
    ? ""
    : affinityConnection.reachable
      ? "affinity-dot-on"
      : "affinity-dot-off";

  const exportData = async () => {
    const dest = await save({
      title: t("settings.exportDataTitle"),
      defaultPath: "fontolo-library.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (dest) await useFontStore.getState().exportLibraryData(dest);
  };

  const importData = async () => {
    const src = await open({
      title: t("settings.importDataTitle"),
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof src === "string") await useFontStore.getState().importLibraryData(src);
  };

  return (
    <AnimatePresence>
      {openState && (
        <motion.div
          className="compare-backdrop settings-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => setSettingsOpen(false)}
        >
          <motion.div
            ref={trapRef}
            className="settings-panel settings-panel-wide"
            initial={{ y: 32, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 20, scale: 0.98, opacity: 0 }}
            transition={springSoft}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t("settings.title")}
          >
            <div className="settings-scroll">
              <header className="compare-head">
                <h2 className="compare-title">{t("settings.title")}</h2>
                <button
                  className="detail-close"
                  aria-label={t("settings.close")}
                  onClick={() => setSettingsOpen(false)}
                >
                  <X size={15} strokeWidth={1.5} />
                </button>
              </header>

              <div className="settings-layout">
                <nav className="settings-nav" aria-label={t("settings.title")}>
                  {CATEGORIES.map(({ id, icon: Icon }) => (
                    <button
                      key={id}
                      className={`settings-nav-btn ${activeCategory === id ? "settings-nav-btn-active" : ""}`}
                      aria-current={activeCategory === id ? "true" : undefined}
                      onClick={() => setSettingsCategory(id)}
                    >
                      <Icon size={14} strokeWidth={1.5} />
                      <span>{t(categoryTitleKey(id))}</span>
                    </button>
                  ))}
                </nav>

                <div key={activeCategory} className="settings-detail">
                  {activeCategory === "language" && (
                    <section className="settings-section">
                      <div className="detail-heading">{t("settings.language")}</div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">
                            <Languages size={13} strokeWidth={1.5} /> {t("settings.language")}
                          </div>
                          <div className="settings-sub">{t("settings.languageSub")}</div>
                        </div>
                        <LanguageSelect />
                      </div>
                                                                                        <div className="settings-translate">
                        <div className="settings-translate-text">
                          <div className="settings-translate-title">{t("settings.translateTitle")}</div>
                          <div className="settings-sub">{t("settings.translateSub")}</div>
                        </div>
                        <div className="settings-data-actions">
                          <button
                            className="settings-data-btn"
                            onClick={() => void openUrl(REQUEST_LANGUAGE_URL).catch(() => {})}
                          >
                            <MessageSquarePlus size={13} strokeWidth={1.5} />
                            {t("settings.requestLanguage")}
                            <ArrowUpRight size={12} strokeWidth={1.5} className="settings-btn-arrow" />
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {activeCategory === "library" && (
                    <section className="settings-section">
                      <div className="detail-heading">{t("settings.library")}</div>

                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.watch")}</div>
                          <div className="settings-sub">{t("settings.watchSub")}</div>
                        </div>
                        <PillToggle
                          on={settings.watchEnabled}
                          onChange={(on) =>
                            void updateSettings({ ...settings, watchEnabled: on })
                          }
                          label={t("settings.watch")}
                        />
                      </div>

                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.autoActivate")}</div>
                          <div className="settings-sub">{t("settings.autoActivateSub")}</div>
                        </div>
                        <PillToggle
                          on={settings.autoActivateImports}
                          onChange={(on) =>
                            void updateSettings({ ...settings, autoActivateImports: on })
                          }
                          label={t("settings.autoActivate")}
                        />
                      </div>

                      <div className="settings-row settings-col">
                        <div>
                          <div className="settings-label">{t("settings.watchedFolders")}</div>
                          <div className="settings-sub">{t("settings.watchedFoldersSub")}</div>
                        </div>
                        <div className="settings-folders">
                          {settings.extraDirs.map((dir) => (
                            <div key={dir} className="settings-folder">
                              <FolderOpen size={13} strokeWidth={1.5} />
                              <span className="detail-mono settings-folder-path">{dir}</span>
                              <button
                                aria-label={t("settings.removeFolder", { dir })}
                                onClick={() =>
                                  void updateSettings({
                                    ...settings,
                                    extraDirs: settings.extraDirs.filter((d) => d !== dir),
                                  })
                                }
                              >
                                <X size={12} strokeWidth={1.5} />
                              </button>
                            </div>
                          ))}
                          <button
                            className="settings-add-folder"
                            onClick={() => void addFolder()}
                            disabled={scanning}
                          >
                            <FolderPlus size={13} strokeWidth={1.5} />
                            {t("settings.addFolder")}
                          </button>
                          {scanning && (
                            <div className="settings-scanning tabular" role="status" aria-live="polite">
                              <LoaderCircle size={13} strokeWidth={1.5} className="settings-scanning-icon" />
                              <ScanProgressText />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="detail-heading">{t("settings.libraryFolder")}</div>
                      <div className="settings-row settings-col">
                        <div>
                          <div className="settings-label">{t("settings.libraryFolder")}</div>
                          <div className="settings-sub">{t("settings.libraryFolderSub")}</div>
                        </div>
                        <div className="settings-folders">
                          <div className={`settings-folder ${customDirActive ? "settings-dim" : ""}`}>
                            <span className="settings-folder-tag">{t("settings.libraryDefault")}</span>
                            <button
                              className="path-link detail-mono settings-folder-path"
                              title={defaultLibDir}
                              onClick={() => void revealItemInDir(defaultLibDir).catch(() => {})}
                            >
                              <FolderOpen size={13} strokeWidth={1.5} />
                              <span className="settings-folder-path">{defaultLibDir}</span>
                            </button>
                          </div>
                          <div className={`settings-row ${customDirActive ? "" : "settings-dim"}`}>
                            <div className="settings-label">
                              <PillToggle
                                on={settings.libraryDirEnabled}
                                onChange={(on) => setCustomDirEnabled(on)}
                                label={t("settings.libraryCustom")}
                              />
                              <span className="settings-folder-path">{t("settings.libraryCustom")}</span>
                            </div>
                            <button className="settings-add-folder" onClick={() => void pickLibraryDir()}>
                              <FolderPlus size={13} strokeWidth={1.5} />
                              {t("settings.libraryAddFolder")}
                            </button>
                          </div>
                          {settings.libraryDir && (
                            <div className={`settings-folder ${customDirActive ? "" : "settings-dim"}`}>
                              <button
                                className="path-link detail-mono settings-folder-path"
                                title={settings.libraryDir}
                                onClick={() =>
                                  void revealItemInDir(settings.libraryDir ?? "").catch(() => {})
                                }
                              >
                                <FolderOpen size={13} strokeWidth={1.5} />
                                <span className="settings-folder-path">{settings.libraryDir}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="detail-heading">{t("settings.libraryData")}</div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">
                            <DatabaseBackup size={13} strokeWidth={1.5} /> {t("settings.curation")}
                          </div>
                          <div className="settings-sub">{t("settings.curationSub")}</div>
                        </div>
                        <div className="settings-data-actions">
                          <button className="settings-data-btn" onClick={() => void exportData()}>
                            <FolderDown size={13} strokeWidth={1.5} />
                            {t("settings.export")}
                          </button>
                          <button className="settings-data-btn" onClick={() => void importData()}>
                            <FolderOpen size={13} strokeWidth={1.5} />
                            {t("settings.import")}
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {activeCategory === "googleFonts" && (
                    <section className="settings-section">
                      <div className="detail-heading">{t("settings.googleFonts")}</div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label"><Globe2 size={13} strokeWidth={1.5} /> {t("settings.googleFontsEnable")}</div>
                          <div className="settings-sub">{t("settings.googleFontsEnableSub")}</div>
                        </div>
                        <PillToggle
                          on={settings.googleFontsEnabled}
                          onChange={(on) => {
                            void updateSettings({ ...settings, googleFontsEnabled: on });
                            if (on) refreshCatalog();
                          }}
                          label={t("settings.googleFontsEnable")}
                        />
                      </div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.googleFontsRefresh")}</div>
                          <div className="settings-sub">
                            {googleFontsProgress.phase === "checking"
                              ? t("settings.googleFontsChecking")
                              : googleFontsProgress.error
                                ? googleFontsProgress.error
                                : t("settings.googleFontsRefreshSub")}
                          </div>
                        </div>
                        <button
                          className="settings-data-btn settings-icon-btn"
                          onClick={refreshCatalog}
                          disabled={!settings.googleFontsEnabled || googleFontsProgress.phase === "checking"}
                          aria-label={t("settings.googleFontsRefresh")}
                          title={t("settings.googleFontsRefresh")}
                        >
                          <RefreshCw size={13} strokeWidth={1.5} className={googleFontsProgress.phase === "checking" ? "settings-scanning-icon" : undefined} />
                        </button>
                      </div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.googleFontsCache")}</div>
                          <div className="settings-sub">
                            {t("settings.googleFontsCacheSub", { size: formatBytes(googleCacheBytes) })}
                          </div>
                        </div>
                        <button className="settings-data-btn" onClick={() => void clearGoogleCache()} disabled={googleCacheBytes === 0}>
                          <Trash2 size={13} strokeWidth={1.5} />
                          {t("settings.googleFontsCacheClear")}
                        </button>
                      </div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.googleFontsLocation")}</div>
                          <div className="settings-sub">{t("settings.googleFontsLocationSub")}</div>
                          <button
                            className="settings-path-btn settings-data-btn"
                            title={googleInstallDir || t("settings.googleFontsLocationEmpty")}
                            onClick={() => {
                              if (googleInstallDir) void revealItemInDir(googleInstallDir).catch(() => {});
                            }}
                          >
                            <FolderOpen size={13} strokeWidth={1.5} />
                            <span>{googleInstallDir || "…"}</span>
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {activeCategory === "autoActivation" && (
                    <section className="settings-section">
                      <div className="detail-heading">{t("settings.lampButtons")}</div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.lampSwap")}</div>
                          <div className="settings-sub">{t("settings.lampSwapSub")}</div>
                        </div>
                        <PillToggle
                          on={settings.swapActivationButtons}
                          onChange={(on) =>
                            void updateSettings({ ...settings, swapActivationButtons: on })
                          }
                          label={t("settings.lampSwap")}
                        />
                      </div>
                      <div className="detail-heading">{t("settings.autoActivationAffinity")}</div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.affinityEnable")}</div>
                          <div className="settings-sub">{t("settings.affinityEnableSub")}</div>
                        </div>
                        <PillToggle
                          on={settings.affinityEnabled}
                          onChange={(on) => {
                            void updateSettings({ ...settings, affinityEnabled: on }).then(() =>
                              refreshAffinityConnection(),
                            );
                          }}
                          label={t("settings.affinityEnable")}
                        />
                      </div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.affinityConnection")}</div>
                          <div className="settings-sub">{affinityDetail}</div>
                        </div>
                        <span className={`affinity-dot ${affinityDot}`} aria-hidden />
                      </div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">{t("settings.affinityDeactivate")}</div>
                          <div className="settings-sub">{t("settings.affinityDeactivateSub")}</div>
                        </div>
                        <PillToggle
                          on={settings.affinityDeactivateOnQuit}
                          onChange={(on) =>
                            void updateSettings({ ...settings, affinityDeactivateOnQuit: on })
                          }
                          label={t("settings.affinityDeactivate")}
                        />
                      </div>
                      <div className="settings-sub">{t("settings.affinityHelp")}</div>
                    </section>
                  )}

                  {activeCategory === "appearance" && (
                    <section className="settings-section">
                      <div className="detail-heading">{t("settings.appearance")}</div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">
                            <SunMoon size={13} strokeWidth={1.5} /> {t("settings.theme")}
                          </div>
                          <div className="settings-sub">{t("settings.themeSub")}</div>
                        </div>
                        <div
                          className="view-toggle sound-toggle"
                          role="radiogroup"
                          aria-label={t("settings.theme")}
                        >
                          {(["dark", "light", "system"] as const).map((mode) => (
                            <button
                              key={mode}
                              role="radio"
                              aria-checked={themePref === mode}
                              className={`view-btn sound-btn ${themePref === mode ? "view-btn-active" : ""}`}
                              onClick={() => setThemePref(mode)}
                            >
                              {t(`theme.${mode}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-row settings-col">
                        <div>
                          <div className="settings-label">
                            <Palette size={13} strokeWidth={1.5} /> {t("settings.accent")}
                          </div>
                          <div className="settings-sub">{t("settings.accentSub")}</div>
                        </div>
                        <div
                          className="accent-swatches"
                          role="radiogroup"
                          aria-label={t("settings.accent")}
                        >
                          {ACCENT_PRESETS.map((hex) => (
                            <button
                              key={hex}
                              role="radio"
                              aria-checked={accent === hex}
                              aria-label={hex}
                              title={hex}
                              className={`accent-swatch ${accent === hex ? "accent-swatch-on" : ""}`}
                              style={{ background: hex }}
                              onClick={() => setAccent(hex)}
                            />
                          ))}
                          <label
                            className="accent-custom"
                            title={t("settings.accentCustom")}
                          >
                            <input
                              type="color"
                              value={accent}
                              onChange={(e) => setAccent(e.target.value)}
                              aria-label={t("settings.accentCustom")}
                            />
                          </label>
                        </div>
                        <button
                          className="accent-reset"
                          onClick={() => setAccent(DEFAULT_ACCENT)}
                        >
                          {t("settings.accentReset")}
                        </button>
                      </div>
                      <div className="detail-heading">{t("settings.sound")}</div>
                      <div className="settings-row">
                        <div>
                          <div className="settings-label">
                            <Volume2 size={13} strokeWidth={1.5} /> {t("settings.interfaceSounds")}
                          </div>
                          <div className="settings-sub">{t("settings.interfaceSoundsSub")}</div>
                        </div>
                        <div
                          className="view-toggle sound-toggle"
                          role="radiogroup"
                          aria-label={t("settings.soundLevelAria")}
                        >
                          {(["off", "subtle", "on"] as const).map((lvl) => (
                            <button
                              key={lvl}
                              role="radio"
                              aria-checked={soundPref === lvl}
                              className={`view-btn sound-btn ${soundPref === lvl ? "view-btn-active" : ""}`}
                              onClick={() => setSoundPref(lvl)}
                            >
                              {t(`sound.${lvl}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {activeCategory === "shortcuts" && (
                    <section className="settings-section">
                      <div className="detail-heading">{t("settings.shortcuts")}</div>
                      <ShortcutsContent />
                    </section>
                  )}
                </div>
              </div>

              <footer className="settings-footer tabular">
                <img className="settings-footer-icon" src="/favicon.png" alt="" draggable={false} />
                Fontoló {APP_VERSION} · {APP_LICENSE} · {t("settings.footerNote")} ·{" "}
                <button
                  className="settings-replay"
                  onClick={() => {
                    setSettingsOpen(false);
                    useFontStore.getState().startTour();
                  }}
                >
                  {t("settings.replayTour")}
                </button>
              </footer>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
