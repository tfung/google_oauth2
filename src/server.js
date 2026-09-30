import express from 'express';
import session from 'express-session';
import * as oidc from 'openid-client'
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

      res.redirect(authorizationUrl.href);
    });
  } catch (error) {
    next(error);
  }
});

app.get('/auth/google/callback', (req, res) => {
  // TODO: Validate state, exchange the code, and verify the ID token
  // with an OIDC library. Regenerate the session before saving the user.
  res.status(501).type('text').send('Exercise 2: implement the Google callback.');
});

app.get('/app', (req, res) => {
  // TODO: Read the authenticated user from your server-side session.
  // Until authentication exists, nobody can access this page.
  res.status(401).type('text').send('Sign-in is not implemented yet. Start at /.');
});

app.post('/logout', (req, res) => {
  // TODO: Validate a CSRF token, destroy the session, clear its cookie,
  // and redirect to /. This should not sign the user out of Google.
  res.status(501).type('text').send('Exercise 3: implement logout.');
});

// Bind only to this computer for the local learning exercise.
app.listen(port, '127.0.0.1', () => {
  console.log(`Open http://localhost:${port}`);
});
