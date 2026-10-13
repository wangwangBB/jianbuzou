import { handleRequest } from './_app.js';

export function onRequest(context) {
  return handleRequest(context.request, context.env);
}
