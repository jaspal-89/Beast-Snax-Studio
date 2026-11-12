# Beast Snax Studio

A YouTube Shorts review dashboard and daily publisher.

## Included

- Responsive dashboard deployed with GitHub Pages.
- Supabase email authentication and owner-scoped Row Level Security.
- Google Drive scanner for the Ready to Upload folder.
- GitHub Actions publisher: uploads at most one approved Short per run.
- Daily schedule: 12:30 UTC / 6:00 PM IST.

This is the application foundation. Nothing can publish until Supabase, Google OAuth and GitHub Actions secrets are configured.

## Workflow

1. Add edited MP4 files to your Google Drive Ready to Upload folder.
2. The daily workflow scans Drive and adds unseen files to Supabase as pending.
3. Sign in to the dashboard, edit title, description and tags, then approve.
4. A later daily run uploads the oldest approved Short as a private scheduled YouTube video.
5. The dashboard records the YouTube URL and status.

A newly discovered file is never auto-approved or uploaded on the same run.

## Setup

### Supabase

1. Create a project at https://supabase.com/.
2. Copy the Project URL and public anon/publishable key from Project Settings → API.
3. Run supabase/schema.sql in the Supabase SQL Editor.
4. Enable Email authentication.
5. Deploy the dashboard, then create your account using its Sign up form.
6. In Authentication → Users, copy your account UUID for the SUPABASE_OWNER_USER_ID secret.

The dashboard uses the public anon key plus signed-in user authentication. The service-role key is used only by GitHub Actions and must never be put in frontend code.

### Google Drive and YouTube

1. In https://console.cloud.google.com/, create/select a Cloud project.
2. Enable Google Drive API and YouTube Data API v3.
3. Configure OAuth consent and create an OAuth 2.0 Desktop app client.
4. Generate a refresh token for the Google account that owns the Drive folder and YouTube channel, with both scopes:
   - https://www.googleapis.com/auth/drive.readonly
   - https://www.googleapis.com/auth/youtube.upload
5. Create the Ready to Upload folder and copy its folder ID from the Drive URL.

OAuth consent/verification requirements may apply. Never paste credentials into chat or commit them to GitHub.

### GitHub Actions secrets

Open repository Settings → Secrets and variables → Actions and add:

| Secret | Value |
|---|---|
| SUPABASE_URL | Supabase Project URL |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service-role key |
| SUPABASE_OWNER_USER_ID | UUID of your dashboard user |
| GOOGLE_CLIENT_ID | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret |
| GOOGLE_REFRESH_TOKEN | OAuth refresh token |
| GOOGLE_DRIVE_FOLDER_ID | Ready to Upload folder ID |

### GitHub Pages

1. Open Settings → Pages.
2. Set Build and deployment source to GitHub Actions.
3. The Pages workflow deploys the dashboard after a push to main.
4. Open the Pages URL, enter the Supabase URL and anon key, then sign in.

### Test

Open Actions → Beast Snax Daily Publisher → Run workflow. Select scan_only for a scan-only test. The scheduled run is daily at 12:30 UTC / 6:00 PM IST. GitHub may delay scheduled jobs during busy periods.

The publisher uploads at most one approved video per run and schedules it about 15 minutes after upload. Verify the first test in YouTube Studio.

## Notes

- Initial title is derived from the filename; description is a placeholder. Review/edit all metadata before approval. AI metadata generation is not enabled yet.
- MP4 files only; current safety limit is 256 MB per file.
- Google OAuth consent, YouTube API quota and account restrictions apply.
- Copyright permission is separate from automation. Only upload clips you have rights/permission to use; reused-content rules may also affect monetization.
- GitHub Pages is static hosting. Supabase stores the queue; GitHub Actions runs the private backend.
- Never add service-role keys, OAuth refresh tokens or client secrets to this repository.

## Local checks

    python -m pip install -r requirements.txt
    python -m py_compile scripts/pipeline.py
