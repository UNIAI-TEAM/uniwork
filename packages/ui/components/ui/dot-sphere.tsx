"use client"

/**
 * Decorative dot field, ported from the ReUI onboarding-3 block.
 *
 * Purely presentational: it paints to a canvas and reads no product state, so
 * it lives with the primitives. It honours `prefers-reduced-motion` by
 * painting one static frame instead of animating.
 */

import { useEffect, useRef } from "react"

import { cn } from "../../lib/utils"

interface DotSphereProps {
  className?: string
  dotGap?: number
  motion?: "travel" | "wave"
  sphereCount?: number
  sphereRadius?: number | `${number}%`
  dotRadiusMax?: number
  speed?: number
  /** Bắt buộc: canvas không đọc được `var()`, và component không được mang
   *  palette riêng — màu phải đến từ token của nơi dùng. */
  bgColor: string
  dotColor: string
  followMouse?: boolean
}

interface SpherePath {
  from: Point
  to: Point
}

interface SphereProfile {
  phase: number
  radius: number
  dot: number
  speed: number
}

interface Point {
  x: number
  y: number
}

interface DotSphereState {
  center: Point
  anchor: Point
  from: Point
  to: Point
  progress: number
  radius: number
  radiusScale: number
  dotRadiusMax: number
  dotScale: number
  speed: number
  color: string
  opacity: number
}

const SPHERE_PATHS: readonly [SpherePath, ...SpherePath[]] = [
  {
    from: { x: -0.28, y: 0.18 },
    to: { x: 1.28, y: 0.78 },
  },
  {
    from: { x: 1.28, y: 0.82 },
    to: { x: -0.28, y: 0.22 },
  },
  {
    from: { x: 0.18, y: 1.24 },
    to: { x: 0.82, y: -0.24 },
  },
]

const WAVE_SPHERE_ANCHORS: readonly [Point, ...Point[]] = [
  { x: 0.28, y: 0.08 },
  { x: 0.76, y: 0.28 },
  { x: 0.38, y: 0.5 },
  { x: 0.78, y: 0.72 },
  { x: 0.34, y: 0.93 },
]

const SPHERE_PROFILES: readonly [SphereProfile, ...SphereProfile[]] = [
  { phase: 0, radius: 1, dot: 1, speed: 1 },
  { phase: 0.2, radius: 0.94, dot: 0.96, speed: 1 },
  { phase: 0.4, radius: 1, dot: 1, speed: 1 },
  { phase: 0.6, radius: 0.94, dot: 0.96, speed: 1 },
  { phase: 0.8, radius: 0.9, dot: 0.94, speed: 1 },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

function easeInOutSine(value: number) {
  return 0.5 - Math.cos(value * Math.PI) * 0.5
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)

  return t * t * (3 - 2 * t)
}

function getTravelOpacity(progress: number) {
  const fadeIn = smoothstep(0.03, 0.24, progress)
  const fadeOut = 1 - smoothstep(0.76, 0.97, progress)

  return Math.min(fadeIn, fadeOut)
}

function getWaveOpacity(progress: number) {
  const pulse = (1 - Math.cos(progress * Math.PI * 2)) * 0.5

  return 0.16 + Math.pow(pulse, 1.28) * 0.84
}

function resolveSphereRadius(
  radius: NonNullable<DotSphereProps["sphereRadius"]>,
  windowSize: { w: number; h: number }
) {
  if (typeof radius === "number") {
    return radius
  }

  const percent = Number.parseFloat(radius)

  if (Number.isNaN(percent)) {
    return Math.max(windowSize.w, windowSize.h)
  }

  return Math.max(windowSize.w, windowSize.h) * (percent / 100)
}

export function DotSphere({
  className,
  dotGap = 20,
  motion = "travel",
  sphereCount = 3,
  sphereRadius = 200,
  dotRadiusMax = 3,
  speed = 0.18,
  bgColor,
  dotColor,
  followMouse = false,
}: DotSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef({
    windowSize: { w: 0, h: 0 },
    circleNumber: { x: 0, y: 0 },
    posStart: { x: 0, y: 0 },
    spheres: [] as DotSphereState[],
    animationId: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const ctx = canvas.getContext("2d")

    if (!ctx) {
      return
    }

    const canvasElement = canvas
    const context = ctx
    const state = stateRef.current
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    let prefersReducedMotion = reducedMotionQuery.matches

    state.spheres = createSpheres()

    function createSpheres() {
      const count = Math.max(1, sphereCount)

      return Array.from({ length: count }, (_, index) => {
        // `index % length` is always in range, but TS can't prove it. The
        // tuple types above make index 0 a sound fallback rather than a `!`.
        const path = SPHERE_PATHS[index % SPHERE_PATHS.length] ?? SPHERE_PATHS[0]
        const anchor =
          WAVE_SPHERE_ANCHORS[index % WAVE_SPHERE_ANCHORS.length] ??
          WAVE_SPHERE_ANCHORS[0]
        const profile =
          SPHERE_PROFILES[index % SPHERE_PROFILES.length] ?? SPHERE_PROFILES[0]

        return {
          center: { x: 0, y: 0 },
          anchor,
          from: path.from,
          to: path.to,
          progress: profile.phase,
          radius: 0,
          radiusScale: profile.radius,
          dotRadiusMax: 0,
          dotScale: profile.dot,
          speed: speed * profile.speed,
          color: dotColor,
          opacity: 0,
        }
      })
    }

    function setDotParams() {
      state.circleNumber = {
        x: Math.floor(state.windowSize.w / dotGap) + 2,
        y: Math.floor(state.windowSize.h / dotGap) + 1,
      }

      state.posStart = {
        x: Math.round(
          (state.windowSize.w - (state.circleNumber.x - 1) * dotGap) / 2
        ),
        y: Math.round(
          (state.windowSize.h - (state.circleNumber.y - 1) * dotGap) / 2
        ),
      }
    }

    function updateSpherePosition(sphere: DotSphereState) {
      if (motion === "wave") {
        sphere.center.x = sphere.anchor.x * state.windowSize.w
        sphere.center.y = sphere.anchor.y * state.windowSize.h
        sphere.opacity = getWaveOpacity(sphere.progress)
        return
      }

      const easedProgress = easeInOutSine(sphere.progress)

      sphere.center.x =
        lerp(sphere.from.x, sphere.to.x, easedProgress) * state.windowSize.w
      sphere.center.y =
        lerp(sphere.from.y, sphere.to.y, easedProgress) * state.windowSize.h
      sphere.opacity = getTravelOpacity(sphere.progress)
    }

    function handleResize() {
      const bounds = canvasElement.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.floor(bounds.width))
      const height = Math.max(1, Math.floor(bounds.height))

      state.windowSize = { w: width, h: height }
      canvasElement.width = Math.floor(width * dpr)
      canvasElement.height = Math.floor(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      setDotParams()
      state.spheres.forEach((sphere) => {
        sphere.radius =
          resolveSphereRadius(sphereRadius, state.windowSize) *
          sphere.radiusScale
        sphere.dotRadiusMax = dotRadiusMax * sphere.dotScale
        updateSpherePosition(sphere)
      })
    }

    function getAlpha(distance: number, radius: number) {
      return 1 - distance / radius
    }

    function getRadius(alpha: number, radiusMax: number) {
      return radiusMax * alpha
    }

    function drawDots() {
      context.beginPath()
      context.fillStyle = bgColor
      context.rect(0, 0, state.windowSize.w, state.windowSize.h)
      context.fill()
      context.closePath()
      context.globalCompositeOperation = "lighter"

      state.spheres.forEach((sphere) => {
        if (sphere.opacity <= 0.01) {
          return
        }

        // Chỉ quét ô lưới nằm trong hình vuông bao quanh sphere. Quét cả lưới rồi
        // mới đo khoảng cách là ném đi phần lớn số vòng lặp — với rail cao, đó là
        // hàng nghìn phép tính mỗi frame cho những điểm chắc chắn ở ngoài.
        const minI = Math.max(0, Math.floor((sphere.center.x - sphere.radius - state.posStart.x) / dotGap) - 1)
        const maxI = Math.min(state.circleNumber.x - 1, Math.ceil((sphere.center.x + sphere.radius - state.posStart.x) / dotGap) + 1)
        const minJ = Math.max(0, Math.floor((sphere.center.y - sphere.radius - state.posStart.y) / dotGap))
        const maxJ = Math.min(state.circleNumber.y - 1, Math.ceil((sphere.center.y + sphere.radius - state.posStart.y) / dotGap))

        // fillStyle/globalAlpha đặt một lần cho cả sphere; save()/restore() mỗi
        // chấm là hàng nghìn lần đẩy/lấy state đồ hoạ cho cùng một giá trị.
        context.fillStyle = sphere.color
        const radiusSquared = sphere.radius * sphere.radius

        for (let i = minI; i <= maxI; i++) {
          for (let j = minJ; j <= maxJ; j++) {
            const gapX = j % 2 === 0 ? -dotGap / 2 : 0
            const x = state.posStart.x + gapX + i * dotGap
            const y = state.posStart.y + j * dotGap
            const dx = x - sphere.center.x
            const dy = y - sphere.center.y
            const distanceSquared = dx * dx + dy * dy

            if (distanceSquared <= radiusSquared) {
              const alpha = getAlpha(Math.sqrt(distanceSquared), sphere.radius)
              const radius = getRadius(alpha, sphere.dotRadiusMax)

              context.globalAlpha = alpha * sphere.opacity
              context.beginPath()
              context.arc(x, y, radius, 0, 2 * Math.PI, false)
              context.fill()
            }
          }
        }

        context.globalAlpha = 1
      })

      context.globalCompositeOperation = "source-over"
    }

    function moveSpheres(event: MouseEvent | null) {
      const bounds = event ? canvasElement.getBoundingClientRect() : null

      state.spheres.forEach((sphere, index) => {
        if (event && followMouse && index === 0 && bounds) {
          sphere.center.x = event.clientX - bounds.left
          sphere.center.y = event.clientY - bounds.top
          sphere.opacity = 1
          return
        }

        if (followMouse && index === 0) {
          return
        }

        sphere.progress =
          (sphere.progress +
            sphere.speed * (motion === "wave" ? 0.0021 : 0.0035)) %
          1
        updateSpherePosition(sphere)
      })
    }

    function render() {
      if (!prefersReducedMotion) {
        moveSpheres(null)
      }

      drawDots()
    }

    function draw() {
      state.animationId = window.requestAnimationFrame(draw)
      render()
    }

    // Vòng lặp này vẽ hàng nghìn cung mỗi frame. Chỉ chạy khi canvas đang thật
    // sự nhìn thấy và tab đang mở — nếu không thì đó là CPU/pin đốt cho một bức
    // tranh không ai xem.
    let running = false
    let onScreen = true

    function stop() {
      if (!running) return
      running = false
      window.cancelAnimationFrame(state.animationId)
    }

    function sync() {
      const shouldRun = !prefersReducedMotion && onScreen && !document.hidden
      if (shouldRun === running) return
      if (shouldRun) {
        running = true
        draw()
      } else {
        stop()
      }
    }

    function handleMouseMove(event: MouseEvent) {
      if (followMouse) {
        moveSpheres(event)
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    const intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting)
      sync()
    })

    resizeObserver.observe(canvasElement)
    intersectionObserver.observe(canvasElement)
    handleResize()
    render()
    sync()

    document.addEventListener("visibilitychange", sync)
    // Thiết lập giảm chuyển động đổi được giữa phiên (nhất là trên macOS/iOS);
    // đọc một lần lúc mount nghĩa là người dùng phải tải lại trang mới có tác dụng.
    const onReducedMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches
      sync()
      if (prefersReducedMotion) render()
    }
    reducedMotionQuery.addEventListener("change", onReducedMotionChange)

    if (followMouse) {
      window.addEventListener("mousemove", handleMouseMove)
    }

    return () => {
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener("visibilitychange", sync)
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange)
      window.removeEventListener("mousemove", handleMouseMove)
      window.cancelAnimationFrame(state.animationId)
    }
  }, [
    dotGap,
    motion,
    sphereCount,
    sphereRadius,
    dotRadiusMax,
    speed,
    bgColor,
    dotColor,
    followMouse,
  ])

  return (
    <canvas
      ref={canvasRef}
      data-slot="dot-sphere"
      className={cn("absolute inset-0 h-full w-full", className)}
    />
  )
}