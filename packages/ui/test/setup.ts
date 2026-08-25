import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { installMediaStubs } from "./media-stub";
import { afterEach } from "vitest";

afterEach(cleanup);

installMediaStubs();
