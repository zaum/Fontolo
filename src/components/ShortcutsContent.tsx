import { useT, type TKey } from "../lib/i18n";

const SECTIONS: [TKey, [string[], TKey][]][] = [
  [
    "sc.navigate",
    [
      [["Ctrl", "K"], "sc.palette"],
      [["/"], "sc.focusSearch"],
      [["↑", "↓", "←", "→"], "sc.move"],
      [["Home", "End"], "sc.firstLast"],
      [["Tab"], "sc.tab"],
      [["Esc"], "sc.esc"],
    ],
  ],
  [
    "sc.select",
    [
      [["Enter"], "sc.selectFocused"],
      [["Shift", "↑ ↓"], "sc.extend"],
      [["Ctrl", "Click"], "sc.addToSelection"],
      [["Shift", "Click"], "sc.selectRange"],
      [["Ctrl", "A"], "sc.selectAll"],
    ],
  ],
  [
    "sc.act",
    [
      [["Space"], "sc.toggleActive"],
      [["C"], "sc.compare"],
      [["F"], "sc.favorite"],
      [["Del"], "sc.trash"],
      [["Shift", "F10"], "sc.contextMenu"],
    ],
  ],
  [
    "sc.help",
    [[["?"], "sc.thisOverlay"]],
  ],
];

export function ShortcutsContent() {
  const t = useT();

  return (
    <div className="shortcuts-body">
      {SECTIONS.map(([section, rows]) => (
        <section key={section} className="shortcuts-section">
          <h3 className="shortcuts-heading">{t(section)}</h3>
          <ul className="shortcuts-list">
            {rows.map(([keys, what]) => (
              <li key={what} className="shortcuts-row">
                <span className="shortcuts-keys">
                  {keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k === "Click" ? t("key.click") : k}
                    </kbd>
                  ))}
                </span>
                <span className="shortcuts-what">{t(what)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
