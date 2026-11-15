# State lineup publishing setup

The existing XC admin page's browser-only login is **not authentication** and does not protect Firebase. State lineup publishing requires a separate Firebase email/password sign-in and Realtime Database rules enforced by Firebase. Do not publish official entries until the database owner has completed and tested this setup.

1. In the existing Firebase project, enable **Email/Password** under Authentication → Sign-in method and create an administrator account. Use the account's UID from Authentication → Users. Do not put passwords or service credentials in this repository.
2. Inspect the **currently deployed** Realtime Database rules in Firebase Console. Back them up before making changes. Merge the following top-level children into the existing `rules` object; **do not replace the rest of the rules**. These rules intentionally use separate top-level paths instead of `crosscountry`:

```json
"state_lineup_admins": {
  "$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": false
  }
},
"state_lineups": {
  ".read": true,
  ".write": "auth != null && root.child('state_lineup_admins').child(auth.uid).val() === true"
}
```

**Important:** Realtime Database grants cascade. If an existing rule at `/` grants `.write`, it overrides both of these child rules. Remove or restrict such a grant before using this feature; similarly ensure nobody can write `state_lineup_admins` through any ancestor rule. Review the entire deployed ruleset and preserve permissions required by other site features. A child `.write: false` cannot revoke an ancestor grant. See [Firebase security rules](https://firebase.google.com/docs/database/security/core-syntax).

3. Using the Firebase Console database editor or a trusted Admin SDK (not the browser client), create `state_lineup_admins/<ADMIN_UID>` with the Boolean value `true`. Repeat for other trusted administrators. Never let ordinary clients write this allowlist. Removing an account's entry revokes its ability to publish.
4. Use the Firebase rules simulator or local emulator with the **complete merged ruleset** to verify that public users can read `state_lineups`, signed-out and non-admin users cannot publish or modify the allowlist, and the allowlisted admin can publish. Also verify that existing site operations still work. Deploy only the reviewed merged rules.
5. Open XC Admin → State Lineups and sign in with the Firebase administrator account. Select the season, division and boys/girls race. Add entries manually or import the provided five-column Athletic.net-style CSV. The import is a reviewed draft; match any unresolved schools and team/individual types, verify the selected race, add the official source or meet, and then publish. Imported files do not establish whether the entries are actually official; the administrator is responsible for verifying the source. Unpublish withdraws the selected list.

The sample format is `grade, athlete name, seed time, school, qualification note` and may be headerless. CSV quoting is supported. The sample has no season or gender, so the administrator must choose these. For notes such as `AAAAN t1` and `AAAAS i2 p11`, `t` indicates a team entry and `i` an individual entry. If the note doesn't indicate a type, choose one manually. Only this sample format has been verified; other Athletic.net exports may have different columns.

Public pages read `state_lineups/<season>/<division>/<M-or-F>`. Published entries replace the regional-estimated field; projections remain estimates. For team scoring the fastest seven rated entries are assumed to start; additional entries are possible alternates, not confirmed scratches. Entries without a matching season rating are shown without a time, and team scores are withheld whenever any entry lacks a rating. A failed list read is reported explicitly and is not presented as an official list.

Firebase documentation: [email/password sign-in](https://firebase.google.com/docs/auth/web/password-auth), [Realtime Database rules](https://firebase.google.com/docs/database/security), and [testing security rules](https://firebase.google.com/docs/rules/emulator-setup).
