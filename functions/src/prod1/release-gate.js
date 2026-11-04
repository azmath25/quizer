// This is an intentional deployment gate, not a runtime user preference.
// A reviewed PROD1 cloud release must explicitly change this constant.
// Environment variables alone cannot turn on experimental backend paths.
export const PROD1_RELEASE_APPROVED=false;
