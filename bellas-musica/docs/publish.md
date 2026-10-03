# Publish Bella's Música (put it on the internet)

This puts the app on a real web address. You don't type any commands: everything is clicking in websites.
Plan about **30 minutes** for steps 1 to 3. Money stays pretend until you do step 6, so nothing can go wrong with
real payments while you set up.

**What it costs:** the host (Render) is about **$7 a month** plus about **$0.50 a month** for the storage that keeps
your database and photos. A web address (domain) is about **$12 a year**. Check the current prices on their sites.
Don't use Render's free plan: it erases the data every time it restarts.

## 1. Make a Render account

1. Go to **render.com** and press **Get Started**. Choose **Sign up with GitHub** and use the same GitHub account that
   has the HQ repository.
2. If it asks to install Render on your GitHub, allow it for the **HQ** repository.
3. Add a payment card under **Billing** (the paid plan is what keeps your data safe).

## 2. Create the site from the blueprint

The repository already has a file (`render.yaml`) that tells Render how to set everything up.

1. In Render, press **New +** → **Blueprint**.
2. Pick the **HQ** repository. For the branch, pick **`claude/gallant-turing-ycaabs`** (that's where the app is).
3. Render shows one service, **bellas-musica**, with a disk. It asks for two things:
   - **ADMIN_EMAILS**: your email address. When you sign up on the site with this email, you get the **Admin** page.
   - **PREVIEW_PASSWORD**: a password you choose (for example `fiesta-preview-2026`). While it's set, the site asks
     everyone for it, so only people you give it to can see the site. You delete it on launch day.
4. Press **Apply**. Render builds the app: wait until the service says **Live** (about 5 minutes the first time).

## 3. Open it and make your account

1. Click the service, and at the top click the address that ends in **.onrender.com**.
2. The browser asks for a user name and password: type anything as the name and your **PREVIEW_PASSWORD**.
3. Press **Sign up** and use the email you put in **ADMIN_EMAILS**. An **Admin** link appears at the top.

The site works like the test drive: payments, texts and emails are pretend, and a blue bar says "Test mode".
Sample groups fill the search until real ones join.

Now you can send the link and the password to a few vendors and families you trust and let them try it on their
phones. On iPhone or Android they can tap **Share → Add to Home Screen** to use it like an app.

## 4. Your own web address (optional, but looks professional)

1. Buy a domain (for example at Namecheap, Cloudflare or Squarespace Domains), like `bellasmusica.com`.
2. In Render, open the service → **Settings** → **Custom Domains** → **Add**, type your domain. Render shows one or two
   records to add.
3. At the company where you bought the domain, open **DNS** and add exactly those records. It can take from a few
   minutes to a few hours. Render shows **Verified** and turns on the lock (https) by itself.
4. In Render → **Environment**, press **Add Environment Variable**: name `BASE_URL`, value `https://bellasmusica.com`
   (your domain, no slash at the end). Press **Save Changes**; the app restarts by itself.

## 5. Updates

Every time a new version is pushed to the branch, Render rebuilds and updates the site on its own. **Your data stays**:
the bookings, accounts and photos live on the disk, not in the code. If an update ever looks wrong, open the service
→ **Events** and press **Rollback** on the version before.

## 6. Turn on the real things (one at a time)

Each one is: sign up on their website, copy a key, and paste it in Render → **Environment** → **Add Environment
Variable** → **Save Changes**. The details for each are in `docs/go-live.md`:

| Turn on | Variables to add | Guide |
|---|---|---|
| Emails (password resets, receipts) | `RESEND_API_KEY`, `EMAIL_FROM`, `BUSINESS_ADDRESS`, `SUPPORT_EMAIL` | go-live.md, step 2 |
| Real payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `docs/stripe.md` (do the test-mode run first) |
| Being told when something breaks | `ALERT_WEBHOOK_URL` (a Discord or Slack link) | go-live.md, step 1 |
| Texts (do last; approval takes weeks) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | `docs/twilio-a2p.md` |

To check everything at once: Render → service → **Shell**, type `npm run preflight` and press Enter. Fix anything
that says FAIL.

## 7. Launch day

1. Fill in `public/terms.html` and `public/privacy.html` (have a lawyer look at them) before real people pay.
2. In Render → **Environment**, delete **PREVIEW_PASSWORD** and **Save Changes**. The site is now open to everyone.
3. When 10 or more real Chicago groups are listed, change **DEMO_SEED** to `0` to remove the sample groups.
4. Follow `docs/chicago-launch.md` to bring in groups and families.

## If something goes wrong

- **The site doesn't open:** Render → service → **Logs** shows what happened. **Events → Rollback** goes back to the
  last version that worked.
- **"Port in use" or other messages on your own computer** don't matter here: Render runs its own copy.
- **Backups:** the app copies the database every night to the disk (`/data/backups`, 14 days kept) and Render also
  snapshots the disk every day (service → **Disks**).
