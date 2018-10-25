/*global global, log */ // <-- jshint
/**
 * Window Options extension
 * mathematical.coffee@gmail.com
 *
 * This extension adds 'minimize', 'maximize', ..., 'always on top'
 * etc options to the right-click menu of the title bar.
 *
 * It is meant to be compatible with the StatusTitleBar extension.
 *
 * NOTE: if you want 'always on top'/'always on visible workspace' items,
 * you need to have the gir*-wnck* package (e.g. gir1.2-wnck-3.0, although the
 * particular version doesn't matter).
 *
 * CHANGES:
 * - maximize/restore are always one item now - performing 'restore' has no
 *   effect if the window is not fully maximized.
 *
 * FAQ/KNOWN ISSUES:
 * - I cannot put in a shade/unshade (roll up/unroll) item. When I try to
 *   call the shade()/unshade() function on a Wnck.Window (because this is
 *   not exposed in Mutter yet), the window disappears! (It will reappear
 *   on restarting gnome-shell). I do not know why this is.
 * - I will not combine the 'raise' and 'lower' items into one, because it
 *   is hard to say whether a window can be raised or lowered (if it's in the
 *   middle of the stacking order it can be *both* raised and lowered), and
 *   hence we don't know whether to put 'Raise' or 'Lower' on the combined item.
 */

/*********** CONFIGURATION ***************/
// The following are purely cosmetic changes for the menu.
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


// This is what will be in the menu (and what order).
// If you don't want an item, comment its line out.
// If you want a separator, enter in 'separator'.
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

//    'FORCE_QUIT', // runs `kill <pid>`, for when a process freezes
    'CLOSE_WINDOW'
];

/* if there are already at least LENGTH_CUTOFF items on the existing window
 * menu, then we'll make ours a submenu instead of a full one (e.g. when
 * we add to the epiphany menu in GNOME 3.2)
 */
const LENGTH_CUTOFF = 4;

/****************** CODE ********************/
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Mainloop = imports.mainloop;
const Signals  = imports.signals;
const Shell = imports.gi.Shell;

const ExtensionSystem = imports.ui.extensionSystem;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

// We use the mutter domain because they have the translations already.
// Do not change any of the following strings or they will not be translated.
// The have underscores in them as the keyboard navigation - I have to put
// them in in order to have my strings translated, but I don't want them in
// the menu so I'll remove them after.
const Gettext = imports.gettext;
const _ = Gettext.domain('mutter').gettext;
const WO_ = Gettext.gettext; // my additional translations

// laziness
Meta.MaximizeFlags.BOTH = Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL;

// For the 'always on top' (make above) and 'always on this workspace' (stick),
// we will use the Meta.Window functions if they are available (3.6+)
//
// Otherwise we'll import Wnck and use that. But if they don't have
// wnck-gir we'll fail gracefully and just not display those options..
var Wnck = false;
if (!Meta.Window.prototype.make_above || !Meta.Window.prototype.stick) {
    try {
        Wnck = imports.gi.Wnck;
    } catch (err) {
        let items_to_remove = [];
        
        // if they have 'make above' don't have to remove (not exposed til ??)
        if (!Meta.Window.prototype.make_above) {
            items_to_remove.push('ALWAYS_ON_TOP');
        }
        if (!Meta.Window.prototype.stick) {
            items_to_remove.push('ALWAYS_ON_VISIBLE_WORKSPACE');
        }
        for (let i = 0; i < items_to_remove.length; ++i) {
            let j = TO_ADD.indexOf(items_to_remove[i]);
            if (j >= 0) {
                TO_ADD.splice(j, 1);
            }
        }
    }
}
let meta_has_make_above = (Meta.Window.prototype.make_above);

const Translations = {
    MINIMIZE                    : _("Mi_nimize"),
    MAXIMIZE                    : _("Ma_ximize"),
    RESTORE                     : _("Unma_ximize"),
    MOVE                        : _("_Move"),
    RESIZE                      : _("_Resize"),
    LOWER                       : WO_("Lower"),
    RAISE                       : WO_("Raise"),
    ALWAYS_ON_TOP               : _("Always on _Top"),
    ALWAYS_ON_VISIBLE_WORKSPACE : _("_Always on Visible Workspace"),
    ALWAYS_ON_THIS_WORKSPACE    : _("_Only on This Workspace"),
// You can have a 'Move to workspace' submenu with all the workspaces in it:
    MOVE_TO_WORKSPACE           : _("Move to Another _Workspace"), // menu
// and/or 'move to (next|previous) workspace' items.
    MOVE_TO_PREVIOUS_WORKSPACE  : _("Move to Workspace _Up"),
    MOVE_TO_NEXT_WORKSPACE      : _("Move to Workspace _Down"),
    FORCE_QUIT                  : _("_Force Quit"),
    CLOSE_WINDOW                : _("_Close")
};
let dummy;
for (dummy in Translations) {
    if (Translations.hasOwnProperty(dummy)) {
        Translations[dummy] = Translations[dummy].replace(/_/g, '');
    }
}
dummy = undefined; // 'delete a' gives 'depreciated' warning.

// Tells me what operation to use for toggle items
const Alternatives = {
    MAXIMIZE : 'RESTORE',
    ALWAYS_ON_VISIBLE_WORKSPACE : 'ALWAYS_ON_THIS_WORKSPACE',
    ALWAYS_ON_TOP : 'NOT_ALWAYS_ON_TOP' // A dummy operation.
};

// Tells me how to keep a window in sync with its label
const CheckFunctions = {
    ALWAYS_ON_TOP : function (win) {
        return win.above;
    },
    ALWAYS_ON_VISIBLE_WORKSPACE : function (win) {
        return win.is_on_all_workspaces();
    },
    MAXIMIZE : function (win) {
        return (win.get_maximized() === Meta.MaximizeFlags.BOTH);
    }
};

function LOG() {
    let msg = arguments[0];
    if (arguments.length > 1) {
        [].shift.call(arguments);
        msg = ''.format.apply(msg, arguments);
    }
    //log(msg);
    return msg;
}

/* A PopupMenuItem that switches its label whenever it is activated.
 * (Like PopupSwitchMenuItem without the switch + label alternation, or
 * PopupAlternatingMenuItem but toggles on click rather than a modifier)
 *
 * When state == true, @text will show on the label. When state == false,
 * @alternateText will show on the label.
 *
 * You can connect to 'toggle' like any other PopupSwitchMenuItem
 */
function PopupAlternatingLabelMenuItem() {
    this._init.apply(this, arguments);
}

PopupAlternatingLabelMenuItem.prototype = {
    __proto__: PopupMenu.PopupSwitchMenuItem.prototype,

    _init: function (text, alternativeText, params) {
        PopupMenu.PopupSwitchMenuItem.prototype._init.call(this, text, true,
            params);
        this.setStatus('');
        this.actor.reactive = true;
        this.actor.has_focus = true;
        this._texts = [alternativeText, text];

        // pass through the 'activate' signal as 'toggled' so that to the user
        // this is just a SwitchMenuItem.
        this.connect('activate', Lang.bind(this, function () {
            this.toggle(); // emits toggle signal for us.
        }));
    },

    toggle: function () {
        PopupMenu.PopupSwitchMenuItem.prototype.toggle.call(this);
        this.label.text = this._texts[+this._switch.state]; // convert to int
    },

    setToggleState: function (state) {
        PopupMenu.PopupSwitchMenuItem.prototype.setToggleState.call(this,
            state);
        this.label.text = this._texts[+this._switch.state]; // convert to int
    }
};

/* WindowMenu class.
 * feed it in a menu to patch (the actual menu, e.g. appMenu.menu) and we
 * will add our items to it.
 * If you want to add this to your own class, you need to override
 * _getCurrentWindowMutter and _getCurrentWindowWnck to return the Meta.Window
 *  or Wnck.Window that you want the actions to apply to.
 */
function WindowOptionsMenuPatch() {
	this._init.apply(this, arguments);
}

WindowOptionsMenuPatch.prototype = {
    _init: function (menu, toAdd, config) {
        this.menu = menu;
        this._items = {};
        this._toAdd = toAdd;
        this._workspaceItems = [];
        this._menuSignals = [];
        this._changeWorkspaceID = null;
        this._config = config;

        if (menu) {
            this.init();
        }
    },

    init: function (menu) {
        this.menu = menu || this.menu;
        if (this.menu) {
            this._setupMenu();
            this._menuSignals.push(this.menu.connect('destroy', Lang.bind(this,
                this._onMenuDestroy)));
            return true;
        }
        LOG("WARNING: set this.menu before calling init().");
        return false;
    },

    /* when the menu we are patching is destroyed, we have to as well. */
    _onMenuDestroy: function () {
        /* remove menu items */
        if (this.submenu) {
            // Note: we don't call this.submenu.destroy() here because if the parent
            // menu has been destroyed already, it has already called .destroy()
            // on all its children, and calling it again here would trigger an
            // error as PopupMenuBase attempts to disconnect the same submenu
            // signals twice (the second time triggering the error "Signal XX
            // not found").
            this.submenu = null;
        }
        this._workspaceItems = [];

        if (this._changeWorkspaceID) {
            global.window_manager.disconnect(this._changeWorkspaceID);
        }

        if (this._NWorkspacesChangeID) {
            global.screen.disconnect(this._NWorkspacesChangedID);
            this._NWorkspacesChangedID = null;
        }

        let i = this._menuSignals.length;
        if (this.menu) { // menu might have been destroyed.
            while (i--) {
                this.menu.disconnect(this._menuSignals[i]);
            }
            this._menuSignals = [];
            this.menu = null;
        }
        this.emit('patch-destroy');
    },

    /* we distinguish destroy() from destroyPatch.
     * All destroyPatch does is call submenu.destroy() additionally to
     * destroyPatch. The reason we don't do submenu.destroy() in destroyPatch is
     * that destroyPatch gets called whenenever the parent menu is destroyed,
     * which calls submenu.destroy() for us. If we try to call it again, we get
     * an error due to already-disconnected signals being disconnected again
     * ("No signal connection 1 found")
     */
    destroy: function () {
        if (this.submenu) {
            this.submenu.destroy();
        }
        this._onMenuDestroy();
    },

    _setupMenu: function () {
        LOG("populating menu. Current length: %d", this.menu.length);
        this.submenu = (LENGTH_CUTOFF >= 0 &&
                this.menu.length >= LENGTH_CUTOFF ?
                new PopupMenu.PopupSubMenuMenuItem(_("Window Menu")) :
                new PopupMenu.PopupMenuSection());
        this.menu.addMenuItem(this.submenu, 0);
        let needsUpdateOnMenuOpen = false;

        /* Add items */
        for (let i = 0; i < this._toAdd.length; ++i) {
            let op = this._toAdd[i]; // op === 'operation'
            if (op.indexOf('separator') === 0) {
                this._items[op] = new PopupMenu.PopupSeparatorMenuItem();
            } else if (op === 'MOVE_TO_WORKSPACE') {
                this._workspaceMenu = this._items[op] =
                    new PopupMenu.PopupSubMenuMenuItem(Translations[op]);
                this._NWorkspacesChangedID = global.screen.connect(
                    'notify::n-workspaces',
                    Lang.bind(this, this._onNWorkspacesChanged)
                );
                this._changeWorkspaceID = global.window_manager.connect(
                    'switch-workspace',
                    Lang.bind(this, this._onWorkspaceChanged)
                );
                this._onNWorkspacesChanged();
                this._onWorkspaceChanged();
            } else if (Alternatives.hasOwnProperty(op)) {
                if (this._config[op] === false) {
                    // non-toggle alternating items
                    // When state == true, Translations[Alternatives[op]]
                    //  will appear on the label (although state == true will
                    //  correspond to Tranlsations[op] being true).
                    //
                    // e.g. for maximize/restore: state == true corresponds to
                    // the window being maximized, but we will display the
                    // 'restore' label.
                    this._items[op] = new PopupAlternatingLabelMenuItem(
                        Translations[Alternatives[op]],
                        Translations[op]
                    );
                } else {
                    // toggles
                    this._items[op] = new PopupMenu.PopupSwitchMenuItem(
                        Translations[op],
                        false
                    );
                }
                LOG(op);
                this._items[op].connect('toggled',
                    Lang.bind(this, this._onActivate, op));
                needsUpdateOnMenuOpen = true;
            } else {
                // normal text menu item
                this._items[op] = new PopupMenu.PopupMenuItem(
                        Translations[op]);
                this._items[op].connect('activate',
                    Lang.bind(this, this._onActivate, op));
            }
            /* PopupSubMenuMenuItem has a .menu but MenuSection doesn't */
            if (this.submenu.menu) {
                this.submenu.menu.addMenuItem(this._items[op]);
            } else {
                this.submenu.addMenuItem(this._items[op]);
            }
        }

        if (this._items.MOVE_TO_NEXT_WORKSPACE ||
                this._items.MOVE_TO_PREVIOUS_WORKSPACE) {
            if (!this._workspaceMenu) {
                this._changeWorkspaceID = global.window_manager.connect(
                    'switch-workspace',
                    Lang.bind(this, this._onWorkspaceChanged)
                );
            }
            this._onWorkspaceChanged();
        }
        /* Whenever menu is opened, update the:
         * - maximize/unmaximize toggle
         * - always on this workspace toggle
         * - always on top toggle
         * - shade/unshade toggle
         * (this is easier than listening to heaps of notify::above etc signals
         * from the window manager)
         */
        if (needsUpdateOnMenuOpen) {
            this._menuSignals.push(this.menu.connect('open-state-changed',
                Lang.bind(this, this._updateToggles)));
        }
    },

    _onNWorkspacesChanged: function () {
        let oldLength = this._workspaceItems.length,
            newLength = global.screen.n_workspaces;
        if (oldLength > newLength) {
            // delete the last (oldLength - newLength) items.
            let i = oldLength - newLength;
            while (i--) {
                (this._workspaceItems.pop()).destroy();
            }
        } else {
            // add new items (1-based labels, 0-based indices)
            let itm;
            for (let i = oldLength + 1; i <= newLength; ++i) {
                // following mutter/src/ui/menu.c: If workspace name is of the
                // form 'Workspace %d' we translate it, otherwise we leave it
                // as-is but add a trailing (workspace num).
                let wName = Meta.prefs_get_workspace_name(i - 1);
                wName = (wName ? wName.trim() : '');
                let match = wName.match(/^Workspace ([0-9])+$/);
                if (wName === '' || match) {
                    wName = _("Workspace %d").format(
                            match && parseInt(match[1], 10) === i ?
                            parseInt(match[1], 10) : i
                    );
                } else {
                    wName += ' (%d)'.format(i);
                }
                itm = new PopupMenu.PopupMenuItem(wName);
                itm.connect('activate', Lang.bind(this, this._onActivate,
                            'MOVE_TO_WORKSPACE', i - 1)); // "Workspace 1" is index 0
                this._workspaceItems.push(itm);
                this._workspaceMenu.menu.addMenuItem(itm);
            }
        }
    },

    _onWorkspaceChanged: function (shellwm, fromI, toI, direction) {
        toI = (toI === undefined ? global.screen.get_active_workspace_index():
                toI);
        if (this._workspaceMenu) {
            if (fromI !== undefined) {
                this._workspaceItems[fromI].setSensitive(true);
            }
            this._workspaceItems[toI].setSensitive(false);
        }
        if (this._items.MOVE_TO_NEXT_WORKSPACE) {
            if (fromI === global.screen.n_workspaces - 1) {
                this._items.MOVE_TO_NEXT_WORKSPACE.setSensitive(true);
            }
            if (toI === global.screen.n_workspaces - 1) {
                this._items.MOVE_TO_NEXT_WORKSPACE.setSensitive(false);
            }
        }
        if (this._items.MOVE_TO_PREVIOUS_WORKSPACE) {
            if (fromI === 0) {
                this._items.MOVE_TO_PREVIOUS_WORKSPACE.setSensitive(true);
            }
            if (toI === 0) {
                this._items.MOVE_TO_PREVIOUS_WORKSPACE.setSensitive(false);
            }
        }
    },

    _getCurrentWindowMutter: function () {
        let windows = Shell.WindowTracker.get_default().focus_app.get_windows();
        for (let i = 0; i < windows.length; i++) {
            if (windows[i].has_focus()) {
                return windows[i];
            }
        }
        // didn't find it.
        return null;
    },

    _getCurrentWindowWnck: function () {
        if (!Wnck) {
            return null;
        }
        let screen = Wnck.Screen.get_default();
        screen.force_update();
        return screen.get_active_window();
    },

    _onActivate: function (item, event, op, extraArgs) {
        LOG('onActivate: ' + op);
        let current_window = null;
        if (extraArgs instanceof Meta.Window ||
                (Wnck && extraArgs instanceof Wnck.Window)) {
            current_window = extraArgs;
        }

        /* Ideally we want to use mutter for everything, but the JS
         * interface doesn't have always on top/always on visible workspace
         * exposed, so we have to use wnck until they do.
         */
        if (!current_window) {
            if ((!Meta.Window.prototype.make_above &&
                    (op === 'ALWAYS_ON_TOP' || op === 'NOT_ALWAYS_ON_TOP')) ||
                (!Meta.Window.prototype.stick &&
                    (op === 'ALWAYS_ON_VISIBLE_WORKSPACE' ||
                     op === 'ALWAYS_ON_THIS_WORKSPACE'))) {
            // go through wnck: not ideal, but these methods are not available
            // through mutter yet.
                current_window = this._getCurrentWindowWnck();
            } else {
                current_window = this._getCurrentWindowMutter();
            }
        }

        if (current_window) {
            // note: this._items[op].state is the *new* state, ie what the user
            // wants to do.
            if (Alternatives.hasOwnProperty(op) && !this._items[op].state) {
                LOG("doing an alternative! : " + op + " --> " + Alternatives[op]);
                this._onActivate(item, event, Alternatives[op], current_window);
                return;
            }

            /* The following are Mutter methods */
            if (op === 'MINIMIZE') {
                current_window.minimize();
            } else if (op === 'MAXIMIZE') {
                // NOTE: see Meta-1.0.gir for exported flags etc.
                current_window.activate(global.get_current_time());
                current_window.maximize(Meta.MaximizeFlags.BOTH);
            } else if (op === 'RESTORE') {
                current_window.activate(global.get_current_time());
                current_window.unmaximize(Meta.MaximizeFlags.BOTH);
            } else if (op === 'MOVE') {
                /* Use global.display.begin_grab_op for move and resize.
                 * (In GNOME 3.4+ see panel.js for details).
                 * It only works with Meta.later_add, because at time of clicking
                 * this dropdown menu has the current grab focus.
                 * Move the cursor to middle of the window.
                 */
                current_window.raise();
                Mainloop.idle_add(function () {
                    let pointer = Gdk.Display.get_default().get_device_manager().get_client_pointer(),
                        [scr,,] = pointer.get_position(),
                        rect    = current_window.get_outer_rect(),
                        x       = rect.x + rect.width / 2,
                        y       = rect.y + rect.height / 2;
                    pointer.warp(scr, x, y);
                    global.display.begin_grab_op(global.screen, current_window,
                        Meta.GrabOp.MOVING, false, true, 1, 0,
                        global.get_current_time(), x, y);
                    return false;
                });
            } else if (op === 'RESIZE') {
                current_window.raise();
                Mainloop.idle_add(function () {
                    let pointer = Gdk.Display.get_default().get_device_manager().get_client_pointer(),
                        [scr,,] = pointer.get_position(),
                        rect    = current_window.get_outer_rect(),
                        x       = rect.x + rect.width,
                        y       = rect.y + rect.height;
                    pointer.warp(scr, x, y);
                    global.display.begin_grab_op(global.screen, current_window,
                        Meta.GrabOp.RESIZING_SE, false, true, 1, 0,
                        global.get_current_time(), x, y);
                    return false;
                });
            } else if (op === 'MOVE_TO_WORKSPACE') {
                if (typeof extraArgs === 'number') {
                    current_window.change_workspace_by_index(
                        extraArgs,
                        false, // don't create new workspace
                        global.get_current_time()
                    );
                } else {
                    LOG('received request to move window to workspace ' +
                            extraArgs);
                }
            } else if (op === 'MOVE_TO_NEXT_WORKSPACE') {
                current_window.change_workspace_by_index(
                    current_window.get_workspace().index() + 1,
                    false, // don't create new workspace
                    global.get_current_time()
                );
            } else if (op === 'MOVE_TO_PREVIOUS_WORKSPACE') {
                current_window.change_workspace_by_index(
                    current_window.get_workspace().index() - 1,
                    false, // don't create new workspace
                    global.get_current_time()
                );
            } else if (op === 'RAISE') {
                current_window.raise();
            } else if (op === 'LOWER') {
                current_window.lower();
            } else if (op === 'CLOSE_WINDOW') {
                current_window.delete(global.get_current_time());
            } else if (op === 'FORCE_QUIT') {
                let pid = current_window.get_pid();
                try {
                    let argv = ['kill', '' + pid];
                    GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
                } catch (e) {
                    logError(e, 'Failed to kill ' + current_window.title);
                }
            /* The following are (potentially) WNCK methods */
            } else if (op === 'ALWAYS_ON_TOP') {
                current_window.activate(global.get_current_time());
                current_window.make_above();
            } else if (op === 'NOT_ALWAYS_ON_TOP') {
                current_window.activate(global.get_current_time());
                current_window.unmake_above();
            } else if (op === 'ALWAYS_ON_VISIBLE_WORKSPACE') {
            /* Note: there is both a `pin` and a `stick` method.
             * I don't notice any difference between the two, but according to
             * http://developer.gnome.org/libwnck/stable/WnckWindow.html#wnck-window-is-pinned
             * `pinned` : "whether window is on all workspace. Pinned state may change anytime a
             *   'workspace-changed' signal gets emitted, but not when 'state-changed' gets emitted
             * `sticky` : "whether a window is sticky. May change any time a "state-changed" signal
             *   gets emitted.
             *
             * Sticky means "stuck to the glass", i.e. does not scroll with viewport.
             * In GDK/GTK+, sticky means "stuck to the glass" and *also* that the window is on all
             * workspaces. But here it only means the viewport aspect of it.
             *
             * Hence I think 'on all workspaces' is 'pin'. (But this can change with workspace-changed?!)
             * (Note - if it's a Meta.Window there's no 'pin', only 'stick')
             */
                current_window.activate(global.get_current_time());
                if (current_window.pin) {
                    current_window.pin();
                } else {
                    current_window.stick();
                }
            } else if (op === 'ALWAYS_ON_THIS_WORKSPACE') {
                current_window.activate(global.get_current_time());
                if (current_window.unpin) {
                    current_window.unpin();
                } else {
                    current_window.unstick();
                }
            } else {
                LOG(WO_("Unrecognized operation '%s'").format(op || WO_("undefined")));
            }
        }
    }, // _onActivate

    _updateToggles: function (obj, open) {
        /* Update the toggle items to reflect window state in case the user
         * changed it externally not using this menu.
         */
        if (!open) {
            return;
        }

        /* always on top item */
        let current_window = this._getCurrentWindowMutter(),
            flag = false;
        for (let op in Alternatives) {
            if (Alternatives.hasOwnProperty(op) && this._items[op]) {
                flag = CheckFunctions[op](current_window);
                if (this._items[op].state !== flag) {
                    this._items[op].setToggleState(flag);
                }
            }
        }
    }
}; // end WindowOptionsMenuPatch.prototype
Signals.addSignalMethods(WindowOptionsMenuPatch.prototype);

/* WindowOptionsMenuHandler class.
 * This tries to find the system title bar object to patch the WindowOptionsMenu
 * to. It also tries to listen for it being destroyed to re-add.
 */
function WindowOptionsMenuHandler() {
	this._init.apply(this, arguments);
}
WindowOptionsMenuHandler.prototype = {
    _init: function (toAdd, config) {
        this.menuPatch = null;
        this.appMenuButton = null;
        this._toAdd = toAdd;
        this._config = config;
        this._startupID = null;
        this._destroyID = null;

        /* Try to get the 'Title Bar' object.
         * This is identified as the object with a ._targetApp property.
         *
         * Note, the only reason we don't just access Main.panel.statusArea.appMenu
         * (or Main.panel._appMenu) directly is because of status title bar....
         * (it doesn't replace main app menu but just hides it. Also, it doesn't
         * inherit from AppMenuButton so I can't event use `instanceof`).
         */
        let children = Main.panel._leftBox.get_children(),
            i = children.length,
            appMenuButton = null;
        while (i--) {
            appMenuButton = this.getAppMenuButton(children[i]);
            if (appMenuButton) {
                break;
            }
        }
        // last resorts: GNOME 3.6 first then 3.4/3.2
        if (!appMenuButton) {
            appMenuButton = (Main.panel.statusArea ?
                Main.panel.statusArea.appMenu :
                Main.panel._appMenu);
        }

        if (appMenuButton) {
            this.setMenu(appMenuButton);
        } else {
            LOG("Couldn't find an appMenu-like object - what to do now?!");
        }
    },

    /** Given an `actor`, if we think it's the app menu button we'll return it.
     * If it's not but it has a `.child` property, we try with that.
     * We return `null` if we couldn't find it.
     */
    getAppMenuButton: function (actor) {
        if (actor._delegate && actor._delegate._targetApp !== undefined) {
            return actor._delegate;

        // in GNOME 3.6 the things in the panel are all nested in a
        // .container (St.Bin) and it's the `.child` that has the _delegate.
        } else if (actor.child) {
            return this.getAppMenuButton(actor.child);
        }
        return null;
    },

    /** repatches item 'appMenuButton' which has member .menu to add
     * our window options menu into it. */
    setMenu: function (appMenuButton) {
        LOG('setMenu: ' + appMenuButton);
        this.appMenuButton = appMenuButton;

        /* destroy the current patch */
        if (this.menuPatch) {
            if (this._destroyID) {
                this.menuPatch.disconnect(this._destroyID);
            }
            //this.menuPatch.destroy(); // it's already had destroy() called by now
            this.menuPatch = null;
        }
        this.menuPatch = new WindowOptionsMenuPatch(appMenuButton.menu,
                this._toAdd, this._config);
        /* theMenu.menu is null until there is a focus app, so wait until then
         * to intialise the menu. Then we can stop listening to this event.
         */
        if (!appMenuButton.menu) {
            let tracker = Shell.WindowTracker.get_default();
            this._startupID = tracker.connect('notify::focus-app', Lang.bind(this, function () {
                if (this.appMenuButton.menu) {
                    this.menuPatch.init(this.appMenuButton.menu);
                    Shell.WindowTracker.get_default().disconnect(this._startupID);
                    this._startupID = null;
                }
            }));
        }
        this._destroyID = this.menuPatch.connect('patch-destroy', Lang.bind(this, this._onMenuDestroy));
    },

    _onMenuDestroy: function () {
        /* Epiphany destroys the menu & replace it with its own (GNOME 3.3+).
         * We wait for it to be made and re-patch it.
         * But *NOTE* you get a *really long* menu, very inconvenient.
         * Add it as a submenu 'Window' ? Or two-columns ?
         */
        LOG('appMenu watcher detected menu patch destroy signal, calling this.setMenu');
        Mainloop.idle_add(Lang.bind(this, function () {
            this.setMenu(this.appMenuButton);
            return false;
        }));
    },

    destroy: function () {
        LOG('destroying the appMenu watcher');
        if (this._startupID) {
            let tracker = Shell.WindowTracker.get_default();
            tracker.disconnect(this._startupID);
            this._startupID = null;
        }
        if (this._destroyID) {
            this.menuPatch.disconnect(this._destroyID);
            this._destroyID = null;
        }
        this.menuPatch.destroy();
        this.menuPatch = null;
        this.appMenuButton = null;
    }
}; // end WindowOptionsMenuHandler.prototype

let windowOptions = null, detectExtensionsID = null;

function init(meta) {
    Gettext.bindtextdomain('window-options',
            GLib.build_filenamev([meta.path, 'locale']));
}

function enable() {
    windowOptions = new WindowOptionsMenuHandler(TO_ADD, TOGGLES);
    detectExtensionsID = ExtensionSystem.connect('extension-state-changed',
        function (obj, extension) {
            if (extension.state === ExtensionSystem.ExtensionState.ENABLED &&
                extension.uuid === 'StatusTitleBar@devpower.org') {
                LOG('enabled status title bar');
                // since StatusTitleBar simply hides the existing appMenu and
                // puts in its own, we have to wait and re-patch it.
                disable();
                enable();
            }
        });
}

function disable() {
    if (windowOptions) {
        windowOptions.destroy();
    }
    if (detectExtensionsID) {
        ExtensionSystem.disconnect(detectExtensionsID);
        detectExtensionsID = null;
    }
    windowOptions = null;
}

