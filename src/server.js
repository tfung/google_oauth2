import express from 'express';
import session from 'express-session';
import * as oidc from 'openid-client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);

// Parse fields submitted by ordinary HTML forms.
app.use(express.urlencoded({ extended: false }));

// Serve public/index.html at /, with no frontend build step.
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
app.use(express.static(publicDirectory));

if (!process.env.SESSION_SECRET) {
  throw new Error('Set SESSION_SECRET in .env');
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // Local development uses HTTP.
    maxAge: 60 * 60 * 1000,
  },
}));

const logSession = (step, req) => {
  const session = req.session;

  console.log(`[session] ${step}`, {
    id: req.sessionID,
    keys: session ? Object.keys(session) : [],
    hasPendingLogin: Boolean(session?.pendingLogin),
    user: session?.user
      ? {
          sub: session.user.sub,
          name: session.user.name,
          email: session.user.email,
        }
      : null,
  });
};

const google = await oidc.discovery(
  new URL('https://accounts.google.com'),
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

const redirectUri = new URL(
  '/auth/google/callback',
  process.env.BASE_URL,
).href;

app.get('/auth/google', async (req, res, next) => {
  try {
    logSession('start login', req);

    // Generate fresh values for this login attempt.
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();

    const codeChallenge =
      await oidc.calculatePKCECodeChallenge(codeVerifier);

    // Keep these on the server for the callback to check later.
    req.session.pendingLogin = {
      state,
      nonce,
      codeVerifier,
    };
    logSession('stored pending login', req);

    const authorizationUrl = oidc.buildAuthorizationUrl(google, {
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Finish saving before the browser leaves our app.
    req.session.save((error) => {
      if (error) return next(error);

      logSession('saved pending login', req);
      res.redirect(authorizationUrl.href);
    });
  } catch (error) {
    next(error);
  }
});

app.get('/auth/google/callback', async (req, res, next) => {
  logSession('received callback', req);
  const pendingLogin = req.session.pendingLogin;
  const loginErrorMessage =
    'Sign-in could not be completed. Please try again from the home page.';

  const sendLoginError = (reason) => {
    req.session.pendingLogin = undefined;
    logSession(`cleared pending login: ${reason}`, req);
    console.warn(`Google sign-in failed: ${reason}`);
    res.status(400).type('text').send(loginErrorMessage);
  };

  if (req.query.error) {
    return sendLoginError('provider rejected the request');
  }

  if (
    !pendingLogin ||
    typeof req.query.state !== 'string' ||
    req.query.state !== pendingLogin.state
  ) {
    return sendLoginError('state validation failed');
  }

  try {
    logSession('before authorization code exchange', req);
    const tokens = await oidc.authorizationCodeGrant(
      google,
      new URL(req.originalUrl, process.env.BASE_URL),
      {
        pkceCodeVerifier: pendingLogin.codeVerifier,
        expectedState: pendingLogin.state,
        expectedNonce: pendingLogin.nonce,
      },
    );
    logSession('after authorization code exchange', req);
    const claims = tokens.claims();
    console.log('Google ID token claims:', claims);

    if (!claims?.sub) {
      return sendLoginError('identity claims did not include a subject');
    }

    logSession('before session regeneration', req);
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return next(regenerateError);

      logSession('session regenerated', req);
      req.session.user = {
        sub: claims.sub,
        name: claims.name,
        email: claims.email,
      };
      req.session.csrfToken = randomBytes(32).toString('hex');
      logSession('stored authenticated user', req);

      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        logSession('saved authenticated session', req);
        res.redirect('/app');
      });
    });
  } catch (error) {
    console.warn(`Google sign-in failed: ${error.name || 'token exchange error'}`);
    sendLoginError('authorization response validation failed');
  }
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

app.get('/app', (req, res) => {
  logSession('requested app page', req);
  const user = req.session.user;

  if (!user) {
    return res.redirect('/');
  }

  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your profile</title>
  </head>
  <body>
    <main>
      <h1>Welcome, ${escapeHtml(user.name || 'Google user')}</h1>
      <dl>
        <dt>Name</dt>
        <dd>${escapeHtml(user.name)}</dd>
        <dt>Email</dt>
        <dd>${escapeHtml(user.email)}</dd>
        <dt>Google subject</dt>
        <dd>${escapeHtml(user.sub)}</dd>
      </dl>
      <form action="/logout" method="post">
        <input type="hidden" name="csrfToken" value="${escapeHtml(req.session.csrfToken)}">
        <button type="submit">Sign out</button>
      </form>
      <a href="/">Back to home</a>
    </main>
  </body>
</html>`);
});

app.post('/logout', (req, res) => {
  logSession('logout requested', req);

  if (!req.session?.user) {
    console.log('[session] logout skipped: no active session');
    res.clearCookie('connect.sid');
    logSession('cleared session cookie', req);
    return res.redirect('/');
  }

  const submittedToken = req.body.csrfToken;
  const sessionToken = req.session.csrfToken;
  const tokensMatch =
    typeof submittedToken === 'string' &&
    typeof sessionToken === 'string' &&
    submittedToken.length === sessionToken.length &&
    timingSafeEqual(
      Buffer.from(submittedToken),
      Buffer.from(sessionToken),
    );

  if (!tokensMatch) {
    console.warn('Logout rejected: CSRF validation failed');
    return res.status(403).type('text').send('Invalid logout request.');
  }

  req.session.destroy((error) => {
    if (error) return res.status(500).type('text').send('Could not sign out.');

    res.clearCookie('connect.sid');
    logSession('cleared session cookie', req);
    res.redirect('/');
  });
});

// Bind only to this computer for the local learning exercise.
app.listen(port, '127.0.0.1', () => {
  console.log(`Open http://localhost:${port}`);
});
