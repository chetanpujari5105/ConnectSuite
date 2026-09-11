# SAF picker probe — moto g34 5G (ZA222JT75K), 2026-09-05

**The raw `uiautomator` dumps were deleted rather than committed.** They listed the contents of this
handset's `Download` folder, which is a person's private files — an offer letter among them. The
evidence that matters is the confirm button's `enabled` state and the refusal strings, and those are
extracted verbatim below. Every dump also carries its node count, which is the enumeration control:
a dump that returned a near-empty tree could produce `enabled=false` for reasons having nothing to
do with the refusal, and the count is what rules that out.

Caller: `com.chetan.connectsuite.debug`, `targetSdk=36`, via `SafProbeActivity` — **not** a
shell-launched intent, which has no calling package and is therefore a different client.

DocumentsUI on this device: `com.google.android.documentsui`, `/data/app`, **versionName 16**,
versionCode 361521000, targetSdk 36, updated 2026-04-13. The SM-S938B's was **versionName 17**.

### 00-initial.xml
    [enumeration control: 167 nodes in this dump]
    breadcrumb_text          enabled=true  text='moto g34 5G'
    header_title             enabled=true  text='Files on moto g34 5G'
    option_menu_create_dir   enabled=true  text='New folder'
    message_title            enabled=true  text='Can’t use this folder'
    message_subtitle         enabled=true  text='To protect your privacy, choose another folder'
    action_button            enabled=true  text='CREATE NEW FOLDER'
    pick_button_overlay      enabled=true  text=''
    button1                  enabled=false text='USE THIS FOLDER'

### 01-download.xml
    [enumeration control: 117 nodes in this dump]

### 02-download-aimed.xml
    [enumeration control: 164 nodes in this dump]
    breadcrumb_text          enabled=false text='moto g34 5G'
    breadcrumb_text          enabled=true  text='Download'
    header_title             enabled=true  text='Files in Download'
    option_menu_create_dir   enabled=true  text='New folder'
    message_title            enabled=true  text='Can’t use this folder'
    message_subtitle         enabled=true  text='To protect your privacy, choose another folder'
    action_button            enabled=true  text='CREATE NEW FOLDER'
    pick_button_overlay      enabled=true  text=''
    button1                  enabled=false text='USE THIS FOLDER'

### 03-inside-download.xml
    [enumeration control: 47 nodes in this dump]
    breadcrumb_text          enabled=false text='moto g34 5G'
    breadcrumb_text          enabled=false text='Download'
    breadcrumb_text          enabled=true  text='Quick Share'
    header_title             enabled=true  text='Files in Quick Share'
    option_menu_create_dir   enabled=true  text='New folder'
    button1                  enabled=true  text='USE THIS FOLDER'

### 04-nonexistent-aim.xml
    [enumeration control: 110 nodes in this dump]
    breadcrumb_text          enabled=false text='moto g34 5G'
    breadcrumb_text          enabled=true  text='DCIM'
    header_title             enabled=true  text='Files in DCIM'
    option_menu_create_dir   enabled=true  text='New folder'
    button1                  enabled=true  text='USE THIS FOLDER'

### 05-aim-pictures.xml
    [enumeration control: 173 nodes in this dump]
    breadcrumb_text          enabled=false text='moto g34 5G'
    breadcrumb_text          enabled=true  text='Pictures'
    header_title             enabled=true  text='Files in Pictures'
    option_menu_create_dir   enabled=true  text='New folder'
    button1                  enabled=true  text='USE THIS FOLDER'

### 06-nonexistent-again.xml
    [enumeration control: 110 nodes in this dump]
    breadcrumb_text          enabled=false text='moto g34 5G'
    breadcrumb_text          enabled=true  text='DCIM'
    header_title             enabled=true  text='Files in DCIM'
    option_menu_create_dir   enabled=true  text='New folder'
    button1                  enabled=true  text='USE THIS FOLDER'
