# TreeApp field guide

How to use the phone app. Written for field staff and for anyone helping them. You do not need to know the database.

The office assigns the work. The phone does not invent the next job. You plant a tree, or you save the audit the office assigned. After you save, that job leaves **Assigned** and waits on **Completed** until the office approves or sends it back.

Drop each photo into `docs/field-screenshots/` using the file name under the picture. Until the photo is there, the box stays empty. Take the shot of the whole phone screen, in portrait, with the button named in that step visible.

## 1. The four buttons

They sit at the bottom of the phone.

| Button | What it is for |
| --- | --- |
| Home | Today’s project, counts, and the way into your open work |
| Tasks | The jobs: Assigned, Completed, Approved, Rejected |
| Search | Find a tree you already saved |
| Profile | Your name, projects, and Sign Out |

![Bottom bar: Home, Tasks, Search, Profile](field-screenshots/01-bottom-bar.png)

Save as `docs/field-screenshots/01-bottom-bar.png`. Show all four labels.

## 2. Words on a card

The word on the **right side of the card** tells you where that job lives.

| You see | It means | Where it sits |
| --- | --- | --- |
| ASSIGNED | The office gave you this job. It is still yours to do. | Tasks → Assigned |
| COMPLETED | You saved it. The office has not answered yet. | Tasks → Completed |
| EDITED | You fixed a job the office sent back, and saved it again. | Tasks → Completed |
| APPROVED | The office accepted it. | Tasks → Approved |
| REJECTED | The office sent it back. Open it and fix what they wrote. | Tasks → Rejected |

A planting card has a green **Planting** button. An audit card does not. You open the audit card, then use **Save Audit** on the tree page.

One tree is still one tree. Audit 2 is the same tree again, not a new tree.

## 3. How the work moves

```
Office assigns it
        |
        v
   Assigned          you do the work and save
        |
        v
   Completed         you wait
        |
        +----> Approved     done
        |
        +----> Rejected     you tap Edit, fix it, save
                    |
                    v
               Completed    (badge says EDITED)
                    |
                    v
               Approved     done
```

You never create Audit 2, 3, or 4. After the office approves Audit 1, they assign Audit 2. It then shows up on Assigned by itself.

![One card on Assigned, badge reading ASSIGNED](field-screenshots/02-assigned-badge.png)

Save as `docs/field-screenshots/02-assigned-badge.png`. The right-side badge must be readable.

## 4. Start the day

1. Open the app. Wait for the Five Elements logo to finish.
2. On **Sign In**, enter the email and password the office gave you. Tap the sign-in button.

![Sign In screen](field-screenshots/03-sign-in.png)

Save as `docs/field-screenshots/03-sign-in.png`.

3. If the app asks you to pick projects, tick the projects you work on and confirm. You stay on that page until you confirm.
4. Home opens. Check **ACTIVE PROJECT** at the top. If it is the wrong place, tap that card and pick the right project.

![Home, active project visible](field-screenshots/04-home.png)

Save as `docs/field-screenshots/04-home.png`. Include the greeting, the project name, and **Capture a Tree**.

5. The numbers under the card mean:
   - **Approved Trees** — trees the office accepted. Tap it to open that list.
   - **Rejected** — sent back. Tap it to fix them.
   - **Completed** — saved, still waiting. Tap it to see them.
   - The ring on **Capture a Tree** — how many jobs are still open, not how many trees exist in the world.

6. If a card says **Land Geofencing Pending**, the land outline is not locked yet. Do that once per project. See section 8. After it is locked, the card goes away.

## 5. Plant a tree

Do this only when Assigned shows a card with a **Planting** button. **Capture a Tree** on Home does not open the camera. It opens the Assigned list.

1. Tap **Home**, then **Capture a Tree**, or tap **Tasks**.
2. Stay on **Assigned**.
3. Find the planting card. The left ID is the task code. Tap **Planting**.

![Assigned list with a Planting button](field-screenshots/05-planting-card.png)

Save as `docs/field-screenshots/05-planting-card.png`. The **Planting** button must be in the shot.

4. The camera opens. The title is **FIELD CAPTURE**. Take three photos, in this order:
   - **Front** — whole tree from the front
   - **Side** — whole tree from the side
   - **Close-up** — leaf, bark, or trunk detail
5. When all three are filled, tap **Confirm Location (3/3)**. If a photo is bad, use **Retake All Photos** and start the three again.

![Camera with Front, Side, and Close-up](field-screenshots/06-three-photos.png)

Save as `docs/field-screenshots/06-three-photos.png`.

6. Allow location if the phone asks. On **Confirm Location**, check the pin. If the GPS looks wrong, tap **Retry GNSS** or **Use GPS**, or **Recapture**.
7. Tap **Confirm Location**.

![Map with Confirm Location](field-screenshots/07-confirm-location.png)

Save as `docs/field-screenshots/07-confirm-location.png`.

8. The form opens. You do not type the tree name. It comes from the assigned job. Check:
   - **TREE ID**
   - **TREE NAME**
   - **SCIENTIFIC NAME** (filled in for you, for example Guava becomes *Psidium guajava*)
   - **FIELD SURVEYOR** and **DATE**
   - **LAND TYPE** — tap the one that matches the place
   - **LAT** and **LONG** — the point you just confirmed
9. Tap **Save capture**.

![Tree form before Save capture](field-screenshots/08-save-capture.png)

Save as `docs/field-screenshots/08-save-capture.png`. Show Tree name, Scientific name, and **Save capture**.

10. You should see **Tree on record**. Tap **Next Task** to go back for the next card.

What just happened: the tree is saved, and that planting job moved from Assigned to Completed. Leave it there. The office will approve it or send it back.

## 6. Save an audit

An audit is a return visit to a tree that is already planted. The office assigns Audit 1, then later Audit 2, Audit 3, and Audit 4. You only do the one that is on Assigned.

1. Open **Tasks → Assigned**.
2. Open the audit card. The badge says **ASSIGNED**. There is no Planting button on this card.
3. The tree page opens. You should see an **ASSIGNED** pill and a green **Save Audit** button at the bottom. If you do not see **Save Audit**, this is not an open audit. Go back.

![Tree page with Save Audit](field-screenshots/09-save-audit-button.png)

Save as `docs/field-screenshots/09-save-audit-button.png`. The bottom button must read **Save Audit**.

4. Tap **Save Audit**. The title becomes **AUDIT 1 DETAILS** (or 2, 3, or 4).
5. Take the visit photos the page asks for. Fill the measurements you can see in the field:
   - **DBH (CM)** — trunk width
   - **HEIGHT (M)**
   - **DENSITY**
   - **CROWN (M)** — how wide the branches spread
   - **CONDITION** — Healthy, Stressed, Diseased, or Dead
   - **MULTI STEM** — Yes or No
   - **AGE (YRS)**
   - **NOTES** — anything the office should know. Keep it short.
6. Tree name, tree id, land type, and the map point stay as they were. Do not expect to move the tree.
7. Tap **Save Audit** at the bottom. The button stays dim until the required fields are filled.

![Audit form](field-screenshots/10-audit-form.png)

Save as `docs/field-screenshots/10-audit-form.png`. Show the audit number in the title and the **Save Audit** button.

8. The app returns you to **Tasks → Completed**. The same card is now **COMPLETED**.

What just happened: only this visit was saved. Audit 2 does not appear by itself. It appears on Assigned after the office approves this one and assigns the next visit.

## 7. If the office sends it back

1. You may land on **Rejected** by yourself when they decide. Or tap **Rejected** on Home, or **Tasks → Rejected**.
2. Read the note on the card. That is what they want changed.
3. Tap **Edit**.
   - A planting opens **EDIT TREE DETAILS**. Fix the photos or details. Tap **Save & Resubmit for Review**.
   - An audit opens **AUDIT … DETAILS**. Fix the visit. Tap **Save Audit**. The tree page of a rejected audit can also say **Edit Audit 1** (or 2, 3, 4). Same job, same visit. Do not start a new one.

![Rejected card with Edit](field-screenshots/11-rejected-edit.png)

Save as `docs/field-screenshots/11-rejected-edit.png`. Show **REJECTED** and **Edit**.

4. After a good save, the card leaves Rejected and shows on Completed. The badge says **EDITED**.
5. Wait. If they approve, it moves to Approved. If they reject again, it comes back to Rejected with a new note.

## 8. Map and the land outline

1. From Home, if you see **Walk & Lock** or **Start Boundary Walk**, tap it. Or open the map from a tree.
2. Walk the corners of the land. Save the corners the screen asks for. When the office lock is done, the pending card on Home disappears.
3. Tap a tree pin to open its card. While that card is open, Mute, the current-location button, and **Auto-Zoom Land Fence** hide so they are not covered. The GPS pill at the top left stays. Close the card and those buttons come back.

![Map with a tree card open](field-screenshots/12-map-tree.png)

Save as `docs/field-screenshots/12-map-tree.png`. Show the tree card and the GPS pill. The hidden buttons should not be in the way of the card.

Use the map to walk to the tree. Planting and audit are still saved from Tasks, not from the pin.

## 9. Search and profile

**Search** is for looking, not for starting a new planting.

- **Condition** — Healthy, Stressed, Diseased, Dead, after a visit has been saved.
- **Status** — assigned, completed, approved, rejected.
- **Audit** — visits already saved, by round.

Tap a row to open the tree. A rejected row still has **Edit**.

![Search](field-screenshots/13-search.png)

Save as `docs/field-screenshots/13-search.png`.

**Profile** shows your name and **All projects**. **Sign Out** is at the bottom. Sign out when you hand the phone to someone else.

![Profile](field-screenshots/14-profile.png)

Save as `docs/field-screenshots/14-profile.png`.

## 10. A normal day, in order

1. Sign in. Check the project.
2. If the land card is showing, walk and lock the boundary once.
3. Open Assigned. Do every **Planting** card: 3 photos, location, **Save capture**.
4. Open Assigned again. Do every audit card: open it, **Save Audit**, fill the visit, **Save Audit**.
5. Look at Completed. Those wait for the office.
6. Look at Rejected before you leave. Fix them the same day if you can.
7. Approved is the record of trees the office accepted. You do not edit those.

## 11. When it looks wrong

| What you see | What to do |
| --- | --- |
| Capture a Tree opened a list, not the camera | That is correct. Tap **Planting** on the card. |
| No Planting button | It is an audit, or it is not Assigned. Open the card. |
| No Save Audit button | The office has not left this audit open, or you opened an approved tree. Go back to Assigned. |
| The card stayed on Assigned after Save Audit | Pull the list down to refresh. It should be on Completed. Do not save it a second time. |
| Audit 2 appeared as soon as you saved Audit 1 | Stop. Do not fill it unless the office told you they assigned it. Tell the office. |
| The same tree is on Assigned and Approved | Work the Assigned audit. The old approved card should leave Approved while that audit is open. |
| Save failed | Read the message. Check signal. Stay on the page and try the save again. Do not kill the app in the middle of **Submitting...**. |
| Scientific name is blank | Tell the office the tree name on the task. Do not type a different tree over an assigned name. |
| Camera or location permission blocked | Tap **Grant Permission**, or turn Camera and Location on for TreeApp in the phone settings. |

## 12. Photo list

Take these 14 shots and save them with these exact names inside `docs/field-screenshots/`.

| File | Screen |
| --- | --- |
| `01-bottom-bar.png` | Home, Tasks, Search, Profile |
| `02-assigned-badge.png` | Card badge ASSIGNED |
| `03-sign-in.png` | Sign In |
| `04-home.png` | Home with project and Capture a Tree |
| `05-planting-card.png` | Planting button |
| `06-three-photos.png` | Front, Side, Close-up |
| `07-confirm-location.png` | Confirm Location |
| `08-save-capture.png` | Save capture |
| `09-save-audit-button.png` | Save Audit on the tree page |
| `10-audit-form.png` | Audit form |
| `11-rejected-edit.png` | Rejected and Edit |
| `12-map-tree.png` | Map with tree card |
| `13-search.png` | Search |
| `14-profile.png` | Profile |

People who change the app should use `docs/DEVELOPER.md` and `docs/AI-UPDATE-PROMPT.md`. This guide is only for using the phone.
