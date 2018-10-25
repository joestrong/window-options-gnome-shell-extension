# Window Options GNOME Shell Extension

This is a GNOME Shell Extension that adds a drop-down menu to the window title bar with minimize, maximize, always on top, always on this workspace, etc. options. 

![Window Options screenshot](http://cdn.bitbucket.org/mathematicalcoffee/window-options-gnome-shell-extension/downloads/window-options.png)

This is useful for when the window frame decoration gets hidden so you can't just right-click on it to access the menu (Google Chrome does this). Works/tested in GNOME 3.2, should work in other versions (no fancy gsettings - edit `extension.js`).

**If the extension doesn't load, check you have Wnck installed: libwnck-devel for Fedora, gir1.2-wnck-1.0 (or 3.0, doesn't matter) for Ubuntu.**

### Changelog
v7 (2.1.1_gnome3.4+):

* fixed bug with workspace names being one off
* updated to 3.8

v5/v6 (on e.g.o):

* Finally added translations (we use the 'mutter' translations when we can, but help is needed by translators to get the rest of the strings translated!)
* Added 'raise'/'lower' items to the menu
* fail gracefully if Wnck-gir is not installed.
* combine maximize/restore into one item.

v3 (gnome 3.2)/v4 (gnome 3.4) (on e.g.o):

* Made sure it works with StatusTitleBar
* Added 'Move to workspace' menu and 'Move to {previous, next} workspace' items.
* Added gsettings support (gnome-shell-extension-prefs) (v4/gnome3.4 only)
* misc. bugfixes.

v2 (on e.g.o), v1.1 (dev-version):

* fixed bug where the menu would conflict with other applications that use the app menu such as Epiphany (on GNOME 3.4+).
* added option to close the current window (as opposed to the 'Quit' button that closes the entire application (i.e. all its windows)).

Written 2012 by mathematical.coffee [mathematical.coffee@gmail.com](mailto:mathematical.coffee@gmail.com).
Project webpage: [at  bitbucket](https://bitbucket.org/mathematicalcoffee/window-options-gnome-shell-extension).

---

# Installation

## **[NEW!]** The easy way (recommended):
One-click install from [extensions.gnome.org](https://extensions.gnome.org/extension/353/window-options/)!

The old easy way:

1. Download the .zip file on the [Downloads page](https://bitbucket.org/mathematicalcoffee/window-options-gnome-shell-extension/downloads).
2. Open `gnome-tweak-tool`, go to "Shell Extensions", "Install Extension" and select the .zip file.

(Developers: the '3.2' branch is the stable one and works for 3.2 up to 3.4).

---

# Configuring

You can change what items appear in the window menu and their order, as well as various aesthetics.

On GNOME 3.2, you have to exit the `extension.js` file. On GNOME 3.4, you can use `gnome-shell-extension-prefs` (from v4 of the extension onwards).

### To hide some items or change the order

This is the relevant snippet from `exension.js` (up the top):

    const TO_ADD = [
        'MINIMIZE',
        'MAXIMIZE', // 'restore' is here too.
        'separator',

        'MOVE',
        'RESIZE',
    //    'RAISE', // to raise a window to the top
    //    'LOWER', // to lower a window to the bottom
        'separator',

        'ALWAYS_ON_TOP',
        'ALWAYS_ON_VISIBLE_WORKSPACE', // 'always on this workspace' is here too.

    //    'MOVE_TO_PREVIOUS_WORKSPACE', // if you want 'Move to workspace up'
    //    'MOVE_TO_NEXT_WORKSPACE', // if you want 'Move to workspace down' 
        'MOVE_TO_WORKSPACE', // if you want a 'Move to another workspace' menu.
        'separator',

        'CLOSE_WINDOW'
    ];

To not show an item, comment the line out. To show it, comment it back in.
To add a separator, add in the string `'separator'`.
The order they appear is how they will appear on the menu.

### Aesthetic: my AppMenu is too big.

Particularly in GNOME 3.4 and onwards, other applications are starting to make use of the app menu that Window Options uses.
This can cause the menus to get quite long.
Window Options can automatically hide itself into a submenu when the menu starts to get too long.

Just change the following value up the top of `extension.js`.
When there are at least this many items in the menu already, Window Options will put itself in a submenu.
Set it to `0` to have Window Options *always* in a submenu, and `-1` to have it *never* in a submenu.

    const LENGTH_CUTOFF = 4;

### Aesthetic: toggling items.

Some items on the window menu are mutually exclusive. For example, 'Maximize'/'Restore', 'Always on this workspace'/'Always on visible workspace'.

You can choose to represent these as either a toggle (For example, 'Always on this workspace' plus an on/off toggle), or a normal menu item whose text changes depending on the state of the window (for example, the 'Maximize' item says 'Maximize' if the window is not maximized and 'Restore' if it is).

To configure this look in `extension.js` and change the value to `true` if you want a toggle, `false` if you want an item with alternating text.

    const TOGGLES = {
        // Do you want the 'Always on visible workspace'/'Always on this workspace'
        // item to be a 'Always on visible workspace' + a toggle, or an item that
        // switches between 'Always on visible workspace' and 'Always on this workspace'?
        ALWAYS_ON_VISIBLE_WORKSPACE : true,

        // Do you want the 'Maximize'/'Unmaximize' item to be 'Maximize' with a toggle,
        //  or an item that switches its label between 'Maximize' and 'Unmaximize'
        //  (no toggle)?
        MAXIMIZE : false
    };

---

# Known Issues (patches welcome!)

* Doesn't currently work with the [Multiple Monitor Panels extension](https://extensions.gnome.org/extension/323/multiple-monitor-panels/) which gives you a top panel per monitor; I think it might replace the title bar that my window options get added on to, but I'm not sure.

---

# Branch Info (for developers)

* Branch 3.2 is compatible with GNOME 3.2 *and* GNOME 3.4, but doesn't have any fancy gsettings or UI for setting options: edit `extension.js` directly.
It is supposed to be stable.
* Branch 3.4 is meant to be configurable with `gnome-shell-extension-prefs`, and is compatible with 3.4, 3.6, 3.8.
* Default branch is not guaranteed to be stable at *any* commit.
