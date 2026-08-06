# Installing Storybound

This guide is for people installing a built Storybound application. It does not require programming knowledge, an online account, or an internet connection after the installer has been obtained.

## Before installing

1. Get the installer from a person or release location you trust.
2. Choose the file for your operating system. A macOS installer ends in `.dmg`, a Windows installer ends in `.exe`, and Linux builds end in `.AppImage` or `.deb`.
3. If you are upgrading an existing Storybound installation, first create a fresh full-library backup by opening **Settings → Data → Export library backup**.

Current development builds are unsigned. Your operating system may therefore ask for additional confirmation even when you built or received the installer from a trusted source. Do not bypass a warning for a file whose origin you cannot verify.

## macOS

1. Open the `.dmg` file.
2. Drag **Storybound** into the **Applications** folder shown in the installer window.
3. Open **Applications**, then open Storybound.
4. If macOS says the developer cannot be verified, close the message. Control-click Storybound, choose **Open**, review the warning, and choose **Open** only if the file came from a trusted source. macOS normally remembers that decision for this copy.

Do not disable Gatekeeper system-wide.

## Windows

1. Open the file ending in `-setup.exe`.
2. Follow the installer prompts.
3. Open Storybound from the Start menu or desktop shortcut.
4. An unsigned development build may show Microsoft Defender SmartScreen. Choose **More info**, verify that the application name and source are what you expect, and choose **Run anyway** only for a trusted build.

Do not turn off SmartScreen or antivirus protection globally.

## Linux AppImage

1. Save the `.AppImage` file somewhere you can keep it, such as an Applications folder in your home directory.
2. Open the file's **Properties** or **Permissions** and allow it to run as a program.
3. Double-click the AppImage to start Storybound.

If your desktop has no graphical permission control, open a terminal in the file's folder and run:

```bash
chmod +x storybound-*.AppImage
./storybound-*.AppImage
```

Some Linux distributions require FUSE to run AppImages. If the AppImage cannot start, use the `.deb` package where available or install the FUSE compatibility package recommended by your distribution.

## Debian or Ubuntu package

1. Double-click the `.deb` file and open it with your software installer.
2. Choose **Install** and enter your computer password if prompted.
3. Open Storybound from the applications menu.

## First launch

Storybound opens to an empty Library with **Getting started**, book creation, and text/package import paths. It does not download sample content or ask the user to sign in. The database and copied covers are created inside the current operating-system user's application-data folder.

All core features work offline. The optional editor AI assistant contacts OpenAI only after the user opens it, provides their own API key, accepts the disclosure, and sends a request.

To see the precise folder, open **Settings → Data → Open data folder**. Do not put the live folder inside a file-sync service and do not edit its database manually.

## Upgrading

1. Open the existing Storybound version and create a full-library backup.
2. Quit Storybound fully.
3. Install the newer version over the existing application.
4. Start Storybound. Database migrations run locally when required.
5. Open a few books and run **Settings → Data → Database integrity check**.
6. Keep the pre-upgrade backup until you are satisfied that the library is intact.

Installing the application over an older version should not remove the separate user-data folder. Uninstalling behaviour differs by operating system, so always keep a backup first.

## Moving to another computer

Do not copy only the application itself. On the old computer, export a passphrase-protected `.storybound-vault` (recommended for portable media) or a full `.storybound-backup`, move the completed file to the new computer, install the same or a newer compatible Storybound version, then restore it. Keep the passphrase separate and remember that Storybound cannot recover it. Follow [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

## Uninstalling

Removing Storybound may leave its local library in the operating-system application-data folder so an accidental uninstall does not destroy writing. If you intend to remove everything:

1. Export and verify a final backup, or consciously decide that no recovery copy is needed.
2. Uninstall the application through the normal operating-system method.
3. Locate the data folder recorded from **Settings → Data → Open data folder**.
4. Delete that folder only after confirming it belongs to Storybound and that the application is closed.

Deleting the data folder is permanent unless it is available in the Trash, Recycle Bin, or another backup.
