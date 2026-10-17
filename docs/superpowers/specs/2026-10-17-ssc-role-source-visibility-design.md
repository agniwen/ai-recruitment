# SSC role, responsible source, and Offer visibility

The user requested an actual workspace role and department/center relationship on the existing SSC pre-entry page. They confirmed that SSC access is limited to responsible sources and begins when a new Offer enters pending SSC receipt, before the SSC clicks Receive. Existing unmatched organizations remain pending association rather than creating new source records.

## Data and identity

- Preserve all 69 responsibility records and optional contact data.
- Add nullable `workspaceRole` and `resumeSourceId` references within the same workspace. Store real role keys and source IDs, not display names. Display current source and role names while preserving imported center text for unresolved records.
- Mark custom workspace roles explicitly with `organizationRole.isSsc`, mutually exclusive with `isOdc`. The existing work/ssc-01 role is the requested SSC角色; convert its classification from ODC to SSC while preserving unrelated roles and existing action configuration.
- Backfill all 69 role references to ssc-01, and associate only the 28 relationships with unique exact normalized source names. Leave the other 41 source references null with a visible 待关联 label. Never match on similar names, TG, or nickname.
- Use normalized nonempty email to match a unique, unbanned real user. Explicit administrator saves may assign an ordinary member to the selected SSC role. Preserve owner/admin/noAccess and global user profile, credentials, verified TG binding, recruiting groups, and pre-registration data.
- On subsequent sign-in, a pending SSC entry may create missing workspace membership, but never overwrite an existing role. Conflicting SSC role intents and ambiguous email matches do not grant access.

## Authorization

An SSC role is recognized independently from whether responsibility rows still exist. An SSC with no valid responsibilities sees no candidates. A candidate is eligible only when the current member and role, responsibility role, email, workspace, candidate JD source, and source reference all match.

Choose the latest Offer version including deleted/cancelled records; do not revive an older Offer. Require a non-null SSC status of pending, confirming, or completed, and exclude deleted, superseded, and expired Offer status. No Offer, legacy null SSC state, missing source, missing email, wrong role, or cancelled/deleted latest Offer denies access. Confirmation completion preserves eligible history.

SSC visibility replaces recruiting/ODC/AI-review unions. Apply the same rule to candidate lists, details, review paths, files, portfolio data, Offer lists/attachments/actions, and Telegram confirmation. Deny SSC access to independent pre-Offer surfaces that cannot be safely tied to an eligible candidate. Preserve existing non-SSC behavior. The pre-existing external review model for identities with neither membership nor SSC pre-entry history is outside this change; known pending SSC identities without membership/noAccess must not use it to bypass SSC restrictions.

Authenticated SSC users retain this restriction on existing public candidate and interview links. Existing anonymous public sharing remains unchanged; this change does not replace that sharing model. Mixed roles containing an SSC role fail closed instead of combining ordinary-role visibility. A first-login provisioning attempt must recheck that an SSC intention still exists after acquiring the workspace lock.

## UI and deployment

Add a workspace role selector restricted to actual SSC roles, defaulting to SSC角色 when available. Replace free-text new centers with a real source selector. Existing unresolved rows remain editable and keep their original names until an administrator selects a source.

Run isolated database and route tests, authorization bypass tests, typecheck, lint, and production build. Back up the current database and deployment configuration before migration/backfill. Deploy to the existing private-IP production entry and retain the HTTPS fallback. Verify all 69 records, 28 linked/41 pending, role classification, no unrelated role/member changes, and real browser behavior. Do not send Telegram messages or configure tokens.
