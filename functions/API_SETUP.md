# F3 API Configuration

This document describes how to configure the F3 Nation API credentials for Cloud Functions and sync scripts.

## Cloud Functions Configuration

For Firebase Cloud Functions, API credentials are stored in Firebase Functions config.

### Setting API Credentials

Run the following commands to set the API credentials (replace with your actual API key):

```bash
firebase functions:config:set f3.api_key="YOUR_API_KEY_HERE"
firebase functions:config:set f3.client="f3nearme"
```

### Viewing Current Config

To view the current configuration:

```bash
firebase functions:config:get
```

### Using in Code

The Cloud Functions code automatically reads from `functions.config().f3.api_key` and `functions.config().f3.client`. If not set, it falls back to environment variables or default values.

## Sync Script Configuration

For the sync script (`functions/scripts/sync-beatdowns.ts`), API credentials can be set via environment variables.

### Option 1: Environment Variables

Set environment variables before running the script:

```bash
export F3_API_KEY="YOUR_API_KEY_HERE"
export F3_CLIENT="f3nearme"
npm start
```

### Option 2: .env File (Recommended)

Create a `.env` file in the `functions/scripts` directory:

```bash
cd functions/scripts
cat > .env << EOF
F3_API_KEY=YOUR_API_KEY_HERE
F3_CLIENT=f3nearme
EOF
```

Then use a package like `dotenv` to load it (requires adding `dotenv` to dependencies):

```typescript
import * as dotenv from 'dotenv';
dotenv.config();
```

### Option 3: Default Values

If no environment variables are set, the script uses hardcoded default values. This is fine for development but not recommended for production.

## Getting Your API Key

Contact the F3 Nation API administrator to obtain your API key. The API key should be kept secure and never committed to version control.

## Security Notes

- Never commit API keys to version control
- The `.env` file should be in `.gitignore` (already configured)
- For production, use Firebase Functions config or secure environment variable management
- Rotate API keys regularly and update all configurations
