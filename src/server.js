import express from 'express';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);

// Parse fields submitted by ordinary HTML forms.
app.use(express.urlencoded({ extended: false }));

// Serve public/index.html at /, with no frontend build step.
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
app.use(express.static(publicDirectory));

app.get('/auth/google', (req, res) => {
  // TODO: Save state, nonce, and a PKCE verifier in a session.
  // Then redirect to Google's authorization endpoint.
  res.status(501).type('text').send('Exercise 1: implement the Google sign-in redirect.');
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
