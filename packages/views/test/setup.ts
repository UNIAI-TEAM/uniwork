import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom không có canvas: DotSphere đã tự thoát khi getContext trả null.
HTMLCanvasElement.prototype.getContext = (() => null) as never;
