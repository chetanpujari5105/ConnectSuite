# SAF picker readings — moto g45 5G (ZN4222NSN6), 2026-09-08

Caller: `com.chetan.connectsuite.debug` at `targetSdk=36`, through `SafProbeActivity`. A
shell-launched intent has no calling package and would be a different client — defect 50's rule,
and the reason the probe exists.

Picker: `com.google.android.documentsui`, **versionName 17**, targetSdk 37, `/data/app`
(Play-updated). Same version as the SM-S938B; the moto g34 5G carried 16.
No Motorola overlay targets DocumentsUI (control: 64 Motorola RROs present, 0 aimed at it).

| # | Reading | Result | Evidence | Control in the SAME dump |
|---|---|---|---|---|
| P1 | Root of internal storage | **REFUSED** — `button1` `enabled=false`, `Can't use this folder` / `To protect your privacy, choose another folder`. Breadcrumb `moto g45 5G`, header `Files on moto g45 5G` | `P1-storage-root.xml`, 124 nodes | `CREATE NEW FOLDER` (`action_button`) `enabled=true`; 8 entries list normally |
| P2 | `Download` itself | **REFUSED** — same button `enabled=false`, same two strings. Breadcrumb `moto g45 5G › Download` | `P2-download.xml`, 70 nodes | `CREATE NEW FOLDER` `enabled=true` |
| P3 | A folder **inside** `Download` (`Download/SafProbe0908`) | **GRANTABLE** — `enabled=true`, and **no refusal message node at all** | `P3-inside-download.xml`, 48 nodes | the same button one level deeper reads `true`, which is what makes P1/P2's `false` a refusal rather than a dead control |
| P3b | An ordinary top-level folder (`Movies`) | **GRANTABLE** — `enabled=true` | `P3-movies-grantable.xml`, 55 nodes | second, independent grantable case |
| P4a | `EXTRA_INITIAL_URI` honoured for a folder that exists | **CONFIRMED** — aimed at `Download/SafProbe0908`, landed exactly there | `P3-inside-download.xml` breadcrumb | — |

## One observation that is NOT a settled reading

Aiming at the **storage root** URI (`primary%3A`) landed the picker in **`Download`**, not at the
root. A second launch with **no** initial URI landed in **`Movies`**. So the root URI did not open
the root — but *last-visited restoration* is not excluded as the explanation, and separating the two
needs a run from a known-clean picker state. Recorded as an observation, not a finding.

The g34 recorded its own version of this: a bad aim landed in `DCIM` rather than degrading to the
parent. Neither device reproduces the SM-S938B's "degrades to the parent". **That sentence is a
single-device reading and must stop being written as general** — which the g34 file already says.

## What this does and does not extend

P1–P3 now hold on **three handsets, two vendors, two DocumentsUI versions (16 and 17)**. They are
still **not** a statement about Android: all three run **Google's** DocumentsUI. A device shipping a
non-Google picker is still owed, and the Folders screen's wall copy still rests on that gap.
