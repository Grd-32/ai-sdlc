// import { clsx, type ClassValue } from "clsx";
// import { twMerge } from "tailwind-merge";

// export function cn(...inputs: ClassValue[]) {
//   return twMerge(clsx(inputs));
// }

// /**
//  * The API is reachable at two different URLs depending on where the code
//  * runs: the browser needs the host-published port (NEXT_PUBLIC_API_URL,
//  * e.g. http://localhost:3001), but Server Components/Route Handlers run
//  * inside the `web` container, where `localhost` refers to that container
//  * itself — they need the Docker Compose service hostname instead
//  * (API_INTERNAL_URL, e.g. http://api:3001). Falls back to the public URL
//  * if API_INTERNAL_URL isn't set, so this still works outside Docker (e.g.
//  * running `next dev` directly on the host, where "localhost" is correct
//  * for both).
//  */
// export function getApiUrl(): string {
//   const isServer = typeof window === "undefined";

//   if (isServer) {
//     return process.env["API_INTERNAL_URL"] ?? process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
//   }

//   return process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
// }
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The API is reachable at two different URLs depending on where the code
 * runs: the browser needs the host-published port (NEXT_PUBLIC_API_URL,
 * e.g. http://localhost:3001), but Server Components/Route Handlers run
 * inside the `web` container, where `localhost` refers to that container
 * itself — they need the Docker Compose service hostname instead
 * (API_INTERNAL_URL, e.g. http://api:3001).
 *
 * Use this for server-side fetch() calls only. For anything the *browser*
 * will navigate to directly (redirect() targets, <a href>, etc.), use
 * getPublicApiUrl() instead — see the comment there for why these must
 * not be conflated.
 */
export function getApiUrl(): string {
  const isServer = typeof window === "undefined";

  if (isServer) {
    return process.env["API_INTERNAL_URL"] ?? process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
  }

  return process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
}

/**
 * Always the browser-facing API URL, regardless of whether this code
 * happens to execute on the server or in the browser.
 *
 * Use this for anything the *browser itself* will navigate to — most
 * importantly next/navigation's redirect() in a Server Component. redirect()
 * runs on the server but its target is consumed by the browser via an HTTP
 * Location header, not by a server-side fetch() — so it must always be the
 * publicly reachable URL (localhost:3001), never the Docker-internal one
 * (http://api:3001), which the browser cannot resolve at all.
 */
export function getPublicApiUrl(): string {
  return process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
}