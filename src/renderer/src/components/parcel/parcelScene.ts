import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  WebGLRenderer
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  bookThickness,
  buildBook,
  buildWrapping,
  disposeMaterial,
  type BookDetails,
  type WrappingRig
} from './bookModel'

const CAMERA_HOME = 12.4
const CAMERA_CLOSEST = 3.1
const CAMERA_FARTHEST = 15
const REST_TILT = 0.08

function easeInOut(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2
}

function easeOutBack(value: number): number {
  const overshoot = 1.5
  return 1 + (overshoot + 1) * (value - 1) ** 3 + overshoot * (value - 1) ** 2
}

/** The stage: a book, its brown paper, and everything that happens to them. */
export class ParcelScene {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(36, 1, 0.1, 60)
  private readonly parcel = new Group()
  private book: Group | null = null
  private wrapping: WrappingRig | null = null
  private frame = 0
  private lastTime = 0
  private disposed = false
  private readonly tweens = new Set<(now: number) => void>()
  private spinning = false
  private turnable = false
  private dragging = false
  private lastPointer = { x: 0, y: 0 }
  private velocity = { x: 0, y: 0 }
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private pinchDistance = 0
  private cameraDistance = CAMERA_HOME
  private cameraTarget = CAMERA_HOME
  private bob = false
  private readonly resizeObserver: ResizeObserver

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion: boolean
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.02
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap

    const environment = new PMREMGenerator(this.renderer)
    this.scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    environment.dispose()

    this.scene.add(new AmbientLight('#fff4e4', 0.35))
    const key = new DirectionalLight('#fff1dc', 2.4)
    key.position.set(-2.6, 4, 9)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -6
    key.shadow.camera.right = 6
    key.shadow.camera.top = 6
    key.shadow.camera.bottom = -6
    key.shadow.radius = 7
    key.shadow.bias = -0.0004
    this.scene.add(key)
    const rim = new DirectionalLight('#fff0dc', 0.45)
    rim.position.set(5, 1.5, -5)
    this.scene.add(rim)

    // Only shadows are drawn, so nothing that passes it should be cut off by it.
    const floor = new Mesh(
      new PlaneGeometry(30, 30),
      new ShadowMaterial({ opacity: 0.22, depthWrite: false })
    )
    floor.position.z = -1.5
    floor.receiveShadow = true
    this.scene.add(floor)

    this.scene.add(this.parcel)
    this.camera.position.set(0, 0, CAMERA_HOME)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.attachInput()
    this.frame = requestAnimationFrame((time) => this.render(time))
  }

  /** Puts a book on the stage, either bare or already wrapped. */
  async load(details: BookDetails, wrapped: boolean): Promise<void> {
    this.book = await buildBook(details)
    if (this.disposed) return
    this.wrapping = buildWrapping(bookThickness(details.wordCount))
    this.wrapping.setWrapped(wrapped ? 1 : 0)
    this.wrapping.string.visible = wrapped
    this.wrapping.group.visible = wrapped
    this.parcel.add(this.book, this.wrapping.group)
    this.parcel.rotation.set(REST_TILT, wrapped ? -0.42 : -0.3, 0)
  }

  /** The parcel arrives and sits waiting. */
  async arrive(): Promise<void> {
    this.parcel.scale.setScalar(0.01)
    await this.tween(650, easeOutBack, (value) =>
      this.parcel.scale.setScalar(Math.max(0.01, value))
    )
    this.bob = !this.reducedMotion
  }

  /** Paper folds around the book, the string ties, and off it goes. */
  async wrapAndSend(onPaper: () => void, onWhoosh: () => void): Promise<void> {
    const wrapping = this.wrapping
    if (!wrapping) return
    wrapping.group.visible = true
    wrapping.setOpacity(0)
    await this.tween(260, easeInOut, (value) => wrapping.setOpacity(value))
    onPaper()
    await this.tween(
      1350,
      (value) => value,
      (value) => wrapping.setWrapped(value)
    )
    wrapping.string.visible = true
    wrapping.string.scale.setScalar(0.2)
    await this.tween(380, easeOutBack, (value) =>
      wrapping.string.scale.setScalar(0.2 + value * 0.8)
    )
    await this.wait(360)
    onWhoosh()
    const start = this.parcel.rotation.y
    await this.tween(
      760,
      (value) => value ** 2.4,
      (value) => {
        this.parcel.position.set(value * 13, value * 6.5, -value * 5)
        this.parcel.rotation.y = start + value * 1.6
        this.parcel.rotation.z = -value * 0.7
        this.parcel.scale.setScalar(1 - value * 0.5)
      }
    )
    this.parcel.visible = false
  }

  /** The string comes off, the paper opens, and the book lifts out and turns. */
  async unwrap(onPaper: () => void): Promise<void> {
    const wrapping = this.wrapping
    const book = this.book
    if (!wrapping || !book) return
    this.bob = false
    this.parcel.position.y = 0
    await this.tween(300, easeInOut, (value) => {
      wrapping.string.scale.setScalar(1 + value * 0.25)
      wrapping.string.position.z = value * 0.5
      if (value > 0.96) wrapping.string.visible = false
    })
    wrapping.string.visible = false
    onPaper()
    await this.tween(
      1300,
      (value) => value,
      (value) => wrapping.setWrapped(1 - value)
    )
    const startTilt = this.parcel.rotation.y
    // The paper drops away behind the book. A shadow cannot fade, so it loses its shadow first.
    wrapping.group.traverse((item) => {
      item.castShadow = false
    })
    await this.tween(
      820,
      (value) => value,
      (value) => {
        const fall = value ** 2
        wrapping.group.position.set(0, -fall * 7.5, -fall * 0.5)
        wrapping.group.rotation.x = fall * 0.55
        wrapping.setOpacity(1 - Math.max(0, value - 0.55) / 0.45)
        this.parcel.rotation.y = startTilt + (0 - startTilt) * easeInOut(value)
      }
    )
    wrapping.group.visible = false
    await this.tween(1500, easeInOut, (value) => {
      this.parcel.rotation.y = value * Math.PI * 2
    })
    this.parcel.rotation.y = 0
    this.turnable = true
    this.spinning = !this.reducedMotion
  }

  /** Lets the book be turned straight away, with no parcel. */
  showBook(): void {
    this.wrapping?.group.removeFromParent()
    this.turnable = true
    this.spinning = !this.reducedMotion
  }

  /** The book flies off to the library. */
  async collect(): Promise<void> {
    this.turnable = false
    this.spinning = false
    this.cameraTarget = CAMERA_HOME
    const startX = this.parcel.rotation.x
    const startY = this.parcel.rotation.y
    const spins = Math.round(startY / (Math.PI * 2)) * Math.PI * 2
    await this.tween(300, easeInOut, (value) => {
      this.parcel.rotation.x = startX + (REST_TILT - startX) * value
      this.parcel.rotation.y = startY + (spins - startY) * value
    })
    await this.tween(
      620,
      (value) => value ** 2,
      (value) => {
        this.parcel.position.set(-value * 8.5, value * 5.2, -value * 2)
        this.parcel.scale.setScalar(1 - value * 0.84)
        this.parcel.rotation.z = value * 0.35
      }
    )
    this.parcel.visible = false
  }

  zoom(amount: number): void {
    this.cameraTarget = Math.min(
      CAMERA_FARTHEST,
      Math.max(CAMERA_CLOSEST, this.cameraTarget * amount)
    )
  }

  turn(yaw: number, pitch: number): void {
    if (!this.turnable) return
    this.spinning = false
    this.parcel.rotation.y += yaw
    this.parcel.rotation.x = Math.min(1.2, Math.max(-1.2, this.parcel.rotation.x + pitch))
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.scene.traverse((item) => {
      if (item instanceof Mesh) {
        item.geometry.dispose()
        disposeMaterial(item.material)
      }
    })
    this.scene.environment?.dispose()
    this.renderer.dispose()
  }

  private wait(milliseconds: number): Promise<void> {
    return this.tween(
      milliseconds,
      (value) => value,
      () => undefined
    )
  }

  private tween(
    milliseconds: number,
    ease: (value: number) => number,
    update: (value: number) => void
  ): Promise<void> {
    if (this.reducedMotion) {
      update(1)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const start = performance.now()
      const step = (now: number): void => {
        const progress = Math.min(1, (now - start) / milliseconds)
        update(ease(progress))
        if (progress >= 1) {
          this.tweens.delete(step)
          resolve()
        }
      }
      this.tweens.add(step)
    })
  }

  private render(time: number): void {
    if (this.disposed) return
    const delta = Math.min(0.05, (time - this.lastTime) / 1000 || 0)
    this.lastTime = time
    for (const step of [...this.tweens]) step(time)
    if (this.bob) this.parcel.position.y = Math.sin(time / 900) * 0.07
    if (this.spinning) this.parcel.rotation.y += delta * 0.42
    if (this.turnable && !this.dragging) {
      this.parcel.rotation.y += this.velocity.x
      this.parcel.rotation.x = Math.min(
        1.2,
        Math.max(-1.2, this.parcel.rotation.x + this.velocity.y)
      )
      this.velocity.x *= 0.92
      this.velocity.y *= 0.92
    }
    this.cameraDistance += (this.cameraTarget - this.cameraDistance) * 0.14
    this.camera.position.z = this.cameraDistance
    this.renderer.render(this.scene, this.camera)
    this.frame = requestAnimationFrame((next) => this.render(next))
  }

  private resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private attachInput(): void {
    const canvas = this.canvas
    canvas.addEventListener('pointerdown', (event) => {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!this.turnable) return
      canvas.setPointerCapture(event.pointerId)
      this.dragging = true
      this.spinning = false
      this.lastPointer = { x: event.clientX, y: event.clientY }
      this.pinchDistance = 0
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (this.pointers.size === 2) {
        const [first, second] = [...this.pointers.values()]
        const distance = Math.hypot(first.x - second.x, first.y - second.y)
        if (this.pinchDistance) this.zoom(this.pinchDistance / distance)
        this.pinchDistance = distance
        return
      }
      if (!this.dragging) return
      const yaw = (event.clientX - this.lastPointer.x) * 0.0085
      const pitch = (event.clientY - this.lastPointer.y) * 0.0085
      this.lastPointer = { x: event.clientX, y: event.clientY }
      this.velocity = { x: yaw * 0.5, y: pitch * 0.5 }
      this.turn(yaw, pitch)
    })
    const release = (event: PointerEvent): void => {
      this.pointers.delete(event.pointerId)
      if (this.pointers.size === 0) this.dragging = false
    }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        if (this.turnable) this.zoom(Math.exp(event.deltaY * 0.0016))
      },
      { passive: false }
    )
  }
}
