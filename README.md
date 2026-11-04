<p align="center">
  <img src="app-icon.svg" width="96" alt="Ricoh Hub icon">
</p>

<h1 align="center">Ricoh Hub</h1>

<p align="center">
  A macOS menu bar app for a Ricoh IM 3500 on the office network, built with Tauri, Rust and React.
</p>

Ricoh Hub reads the printer over IPP, SNMP and eSCL, so it needs no Ricoh driver
and no login. It shows supplies, trays, counters and jobs; prints and cancels
jobs; scans from the glass or the feeder to a folder; and keeps watching from the
menu bar, with notifications when paper, toner or a jam needs someone and charts
of pages per day. The interface is in Vietnamese.

It is early, tested against one IM 3500 (firmware 5.30) on macOS only.

## Install

```bash
brew install --cask twan-nguyen/ricoh/ricoh-hub
```

The cask needs Homebrew 6.0.16 or newer; on an older one it reads as unreadable, so run `brew update` first.

On first launch, enter the printer's IP address on the **Kết nối máy in** screen.

## Development

You need Rust, Node.js and pnpm.

```bash
pnpm install
pnpm tauri dev
```

How the app talks to the printer, and the printer's quirks, are in
[docs/development.md](docs/development.md). Releasing is in
[docs/releasing.md](docs/releasing.md).
