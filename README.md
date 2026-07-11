# 📄 Naukri Resume Auto-Updater

Automatically updates your resume on **Naukri.com** every day at **10:00 AM IST** using GitHub Actions + Playwright.

---

## 📁 Repo Structure

```
naukri-resume-updater/
├── .github/
│   └── workflows/
│       └── update-resume.yml   ← GitHub Actions workflow
├── resume/
│   └── resume.pdf              ← ✅ PUT YOUR RESUME HERE
├── scripts/
│   ├── package.json
│   └── update-naukri.js        ← Playwright automation script
└── README.md
```

---

## 🚀 Setup Instructions

### 1. Create the GitHub Repository

```bash
git init naukri-resume-updater
cd naukri-resume-updater
# Copy all files here, then:
git add .
git commit -m "Initial setup"
git remote add origin https://github.com/YOUR_USERNAME/naukri-resume-updater.git
git push -u origin main
```

### 2. Add Your Resume

Place your resume as `resume/resume.pdf` in the repo.

> ⚠️ Keep your resume file named exactly `resume.pdf`

### 3. Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these 4 secrets:

| Secret Name           | Value                                                  |
|-----------------------|--------------------------------------------------------|
| `NAUKRI_EMAIL`        | Your Naukri login email                                |
| `NAUKRI_PASSWORD`     | Your Naukri login password                             |
| `GMAIL_APP_PASSWORD`  | Your 16-character Gmail App Password (see Step 4)      |
| `NAUKRI_PROFILE_ID`   | Your Naukri profile ID (see Step 5)                    |

---

### 4. Generate Gmail App Password

> This is needed so the bot can automatically read the OTP Naukri sends to your Gmail.

**Step 1** — Go to: https://myaccount.google.com/security

**Step 2** — Make sure **2-Step Verification is ON** (required, otherwise App Passwords won't show)

**Step 3** — Go to: https://myaccount.google.com/apppasswords

**Step 4** — In the text box type `Naukri Bot` → click **Create**

**Step 5** — Google shows you a 16-character password like:

```
abcd efgh ijkl mnop
```

> ⚠️ Copy it immediately — it only shows once. Remove the spaces when adding to GitHub Secrets.

**Step 6** — Add it as a GitHub secret named `GMAIL_APP_PASSWORD`

> 💡 This is NOT your real Gmail password. It's a special one-time code only for this bot. You can delete it from Google anytime without affecting your main account.

---

### 5. Find Your Naukri Profile ID

The Profile ID is a unique ID linked to your Naukri account. Here's how to find it using browser DevTools:

**Step 1** — Log in to [naukri.com](https://www.naukri.com) and go to your profile page

**Step 2** — Press `F12` (or right click anywhere → **Inspect**) to open DevTools

**Step 3** — Click the **Network** tab in DevTools

**Step 4** — Refresh the page (`Ctrl + R` on Windows / `Cmd + R` on Mac)

**Step 5** — In the filter/search box at the top of Network tab, type `profileId`

**Step 6** — Click on any request that appears → go to **Response** tab → you will see JSON like:

```json
{
  "profileId": "abc123xyz456",
  ...
}
```

**Step 7** — Copy that value and add it as GitHub secret named `NAUKRI_PROFILE_ID`

> 💡 **Alternative method:** Go to your Naukri profile page and check the URL directly:
> `https://www.naukri.com/mnjuser/profile?id=YOUR_PROFILE_ID`
> Copy the value after `?id=`

---

### 6. Enable GitHub Actions

Go to your repo → **Actions** tab → Enable workflows if prompted.

---

## ⏰ Schedule

The workflow runs at **10:00 AM IST (04:30 UTC)** every day.

To change the time, edit `.github/workflows/update-resume.yml`:

```yaml
- cron: '30 4 * * *'   # 04:30 UTC = 10:00 AM IST
```

Use [crontab.guru](https://crontab.guru) to calculate your preferred time in UTC.

> ⚠️ GitHub's scheduler can sometimes be delayed by 15–60 minutes during high traffic. This is normal.

---

## 🔄 How It Works

Every day at 10 AM IST, the bot:

1. Opens Naukri login page in a hidden Chrome browser
2. Fills in your email and password
3. Detects the OTP page (Naukri sends OTP for new/unknown devices)
4. Reads the OTP automatically from your Gmail using IMAP
5. Enters the OTP into the 6 boxes and clicks Verify
6. Logs in successfully
7. Renames your resume with today's date (e.g. `Saurav_Thakur_Updated_Resume_21Jun2026.pdf`)
8. Uploads it to your Naukri profile
9. Deletes the OTP email from your Gmail inbox automatically

---

## 🖱️ Manual Trigger

You can also run the workflow manually anytime:

1. Go to **Actions** tab in your repo
2. Click **Naukri Resume Updater**
3. Click **Run workflow**

---

## 🐛 Debugging

If the workflow fails:
- Go to **Actions** → click the failed run → check logs
- Screenshots are automatically saved as artifacts at every step
- Download the `screenshots.zip` artifact to see exactly what the browser saw

### Common Issues

| Problem | Fix |
|---|---|
| Login failed | Double-check `NAUKRI_EMAIL` and `NAUKRI_PASSWORD` secrets |
| OTP not received | Make sure `GMAIL_APP_PASSWORD` is correct and 2-Step Verification is ON |
| OTP not extracted | Download artifact and check `otp-email-text.txt` to see what was read |
| Resume not found | Make sure file is at `resume/resume.pdf` (exact name) |
| Upload button not found | Naukri may have updated their UI — check the profile screenshot in artifacts |
| Workflow not running on schedule | Push an empty commit: `git commit --allow-empty -m "resync" && git push` |

---

## 🔒 Security Notes

- **Never** commit your email/password directly into code
- All credentials are stored as encrypted GitHub Secrets
- The repo can be **private** for extra safety
- The Gmail App Password only gives read access to your inbox — it cannot send emails or access other Google services

---

## 📝 Updating Your Resume

1. Replace `resume/resume.pdf` with your new file (keep the same name)
2. Commit and push — the next scheduled run will upload the new version

```bash
cp /path/to/new-resume.pdf resume/resume.pdf
git add resume/resume.pdf
git commit -m "Update resume"
git push
```
