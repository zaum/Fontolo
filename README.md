# Fontolo

The free, open-source font manager for Linux, Windows and macOS.

Preview, organize, activate and install fonts from one clean, fast, native app.

## Features

* Live previews of every family, with adjustable size and custom sample text
* Activate and deactivate fonts without installing them system-wide
* Tags, collections, favorites and notes to organize your library
* Full-text search, filters, waterfall and side-by-side compare views
* Drag and drop install, trash with restore, specimen export
* Affinity, Photoshop and Illustrator integration
* Google Fonts catalogue: preview thousands of families without installing them, and activate a style to make it usable everywhere

## Platform notes

* Google Fonts previews are cached web fonts (WOFF2) kept in the app data folder; they are never installed and never visible to other applications.
* Activating a Google font downloads the full desktop file into your user font folder (`%LOCALAPPDATA%\Microsoft\Windows\Fonts` on Windows, `~/.local/share/fonts` on Linux, `~/Library/Fonts` on macOS) and registers it with the system, so every application can use it. A font folder sub-path is deliberately avoided, because macOS does not read sub-folders of `~/Library/Fonts`.
* The Google Fonts previews are fetched from Google's servers; the catalogue check and every preview are separate, small requests.

## Core code based on

Core code based on [ZFontManager by TheHolyOneZ](https://github.com/TheHolyOneZ/ZFontManager).

## License

Fontolo is free software, released under the [GNU General Public License v3.0](LICENSE).
