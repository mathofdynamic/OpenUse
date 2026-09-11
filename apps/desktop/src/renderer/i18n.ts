import type { AgentStatus, Locale, ProviderId, ReasoningEffort } from "@openuse/shared";

type MessageValues = Record<string, string | number>;

const faMessages: Record<string, string> = {
  "computer runtime": "اجرای کنترل رایانه",
  "OpenUse navigation": "ناوبری OpenUse",
  Workspace: "فضای کار",
  "Thread management": "مدیریت رشته‌ها",
  Thread: "رشته",
  Threads: "رشته‌ها",
  "New thread": "رشتهٔ جدید",
  "Continue work without losing the thread.": "کار را بدون از دست دادن رشته ادامه دهید.",
  Unfiled: "بدون پوشه",
  "New folder": "پوشهٔ جدید",
  "Folder name": "نام پوشه",
  "Create folder": "ایجاد پوشه",
  Cancel: "لغو",
  "Thread folders": "پوشه‌های رشته‌ها",
  "All threads": "همهٔ رشته‌ها",
  "No folder": "بدون پوشه",
  "No threads in this folder.": "در این پوشه رشته‌ای وجود ندارد.",
  "Move thread": "انتقال رشته",
  "No tasks yet": "هنوز وظیفه‌ای وجود ندارد",
  "{count} threads": "{count} رشته",
  "Task history": "تاریخچهٔ وظایف",
  "Context compacted": "زمینه فشرده شد",
  Task: "وظیفه",
  actions: "عمل",
  steps: "مرحله",
  "Continue in this thread": "ادامه در این رشته",
  "The usage ledger stores model IDs, token counts, action counts, timing, status, reasoning level, and known cost. Thread history stores task commands so you can continue work. Screenshots, accessibility content, credentials, and chain-of-thought are not written.": "دفتر ثبت مصرف، شناسهٔ مدل، تعداد توکن‌ها و عملیات، زمان، وضعیت، سطح استدلال و هزینهٔ شناخته‌شده را ذخیره می‌کند. تاریخچهٔ رشته، دستورهای وظایف را برای ادامهٔ کار نگه می‌دارد. تصویر صفحه، محتوای دسترسی‌پذیری، اعتبارنامه‌ها و زنجیرهٔ فکر ذخیره نمی‌شوند.",
  "A new thread could not be created.": "رشتهٔ جدید ایجاد نشد.",
  "The thread could not be opened.": "رشته باز نشد.",
  "The thread folder could not be created.": "پوشهٔ رشته ایجاد نشد.",
  "The thread could not be moved.": "رشته جابه‌جا نشد.",
  "Control room": "اتاق کنترل",
  Settings: "تنظیمات",
  "Local runtime": "اجرای محلی",
  "{platform} control is connected.": "کنترل {platform} متصل است.",
  "macOS permissions are required.": "مجوزهای macOS لازم است.",
  "OpenUse 0.2.0 / {platform}": "OpenUse ۰.۲.۰ / {platform}",
  "OpenUse header": "سرصفحهٔ OpenUse",
  "Window controls": "کنترل‌های پنجره",
  "Minimize window": "کمینه‌سازی پنجره",
  "Maximize window": "بیشینه‌سازی پنجره",
  "Restore window": "بازگردانی پنجره",
  "Close window": "بستن پنجره",
  Desktop: "دسکتاپ",
  "Browser preview": "پیش‌نمایش مرورگر",
  Gateway: "درگاه",
  "Custom model": "مدل سفارشی",
  "OpenUse could not load its local settings.": "OpenUse نتوانست تنظیمات محلی خود را بارگذاری کند.",
  "Add an AI Gateway key in Settings to run a task.": "برای اجرای وظیفه، کلید درگاه هوش مصنوعی را در تنظیمات اضافه کنید.",
  "Configure the custom endpoint before running a task.": "پیش از اجرای وظیفه، نقطهٔ اتصال سفارشی را پیکربندی کنید.",
  "{platform} control is not available on this host.": "کنترل {platform} در این میزبان در دسترس نیست.",
  "Grant the required macOS privacy permissions before running Computer Use.": "پیش از اجرای کنترل رایانه، مجوزهای حریم خصوصی لازم macOS را اعطا کنید.",
  "Choose a model with {issues} for Computer Use.": "برای کنترل رایانه، مدلی با قابلیت {issues} انتخاب کنید.",
  "OpenUse could not start the task.": "OpenUse نتوانست وظیفه را شروع کند.",
  "OpenUse could not stop the task.": "OpenUse نتوانست وظیفه را متوقف کند.",
  "The desktop bridge is available inside Electron only.": "پل دسکتاپ فقط درون Electron در دسترس است.",
  "Gateway settings could not be saved.": "تنظیمات درگاه ذخیره نشد.",
  "Custom provider settings could not be saved.": "تنظیمات ارائه‌دهندهٔ سفارشی ذخیره نشد.",
  "Appearance could not be saved.": "تنظیمات ظاهر ذخیره نشد.",
  "Language could not be saved.": "تنظیمات زبان ذخیره نشد.",
  "Reasoning setting could not be saved.": "تنظیمات استدلال ذخیره نشد.",
  "Connection test failed.": "آزمایش اتصال ناموفق بود.",
  Reasoning: "استدلال",
  Spend: "هزینه",
  total: "مجموع",
  requests: "درخواست",
  permission: "مجوز",
  from: "از",
  "{platform} control ready": "کنترل {platform} آماده است",
  "{platform} permission required": "مجوز {platform} لازم است",
  "{platform} control unavailable": "کنترل {platform} در دسترس نیست",
  "{platform} control offline": "کنترل {platform} آفلاین است",
  "Open Settings": "باز کردن تنظیمات",
  "Compact navigation": "ناوبری فشرده",
  Activity: "فعالیت",
  "Local Computer Use": "کنترل رایانهٔ محلی",
  "Put the next action in motion.": "اقدام بعدی را اجرا کنید.",
  "Give OpenUse a clear command. It observes your desktop, acts through guarded tools, and shows you what changed.": "دستور روشنی به OpenUse بدهید. دسکتاپ را بررسی می‌کند، با ابزارهای محافظت‌شده عمل می‌کند و تغییرات را نشان می‌دهد.",
  "Current model": "مدل فعلی",
  Vision: "تصویر",
  "No vision": "بدون تصویر",
  Tools: "ابزارها",
  "No tools": "بدون ابزار",
  "Dismiss error": "بستن خطا",
  "Current task": "وظیفهٔ فعلی",
  Ready: "آماده",
  Working: "در حال کار",
  Completed: "تکمیل شد",
  Stopped: "متوقف شد",
  "Needs attention": "نیازمند توجه",
  "Step {step} / {actions} actions": "مرحلهٔ {step} / {actions} عمل",
  "{count} actions": "{count} عمل",
  "Task spend": "هزینهٔ وظیفه",
  "20-step estimate": "برآورد ۲۰ مرحله‌ای",
  "Tell OpenUse what to do...": "به OpenUse بگویید چه کاری انجام دهد...",
  "Task command": "دستور وظیفه",
  "Ctrl + Enter to run": "Ctrl + Enter برای اجرا",
  "Stop task": "توقف وظیفه",
  "Run task": "اجرای وظیفه",
  "Runtime details": "جزئیات اجرا",
  "Computer state": "وضعیت رایانه",
  "{platform} desktop": "دسکتاپ {platform}",
  "{platform} control": "کنترل {platform}",
  "Actions stay local. Native accessibility is preferred; screenshots are used only when needed.": "عملیات محلی می‌مانند. دسترسی‌پذیری بومی در اولویت است و تصویر صفحه فقط هنگام نیاز استفاده می‌شود.",
  Protocol: "پروتکل",
  Usage: "مصرف",
  "This task": "این وظیفه",
  "OpenUse total": "مجموع OpenUse",
  "View usage": "مشاهدهٔ مصرف",
  Model: "مدل",
  "Ready for Computer Use": "آمادهٔ کنترل رایانه",
  "Tool calling": "فراخوانی ابزار",
  "Safety posture": "وضعیت ایمنی",
  "Semantic UI before coordinates": "رابط معنایی پیش از مختصات",
  "App permissions on every control path": "مجوز برنامه در همهٔ مسیرهای کنترل",
  "Stop cancels model and native work": "توقف، کار مدل و کنترل بومی را لغو می‌کند",
  "Review permissions": "بازبینی مجوزها",
  "Your computer, on request.": "رایانهٔ شما، هر وقت بخواهید.",
  "Start with a small task. OpenUse will observe, act, and verify each step.": "با یک وظیفهٔ کوچک شروع کنید. OpenUse هر مرحله را بررسی، اجرا و تأیید می‌کند.",
  You: "شما",
  User: "کاربر",
  "Permission required": "مجوز لازم است",
  "Allow OpenUse to control {app}?": "اجازه می‌دهید OpenUse، {app} را کنترل کند؟",
  "OpenUse wants to": "OpenUse می‌خواهد",
  "The runtime classified this as": "اجرای محلی این مورد را چنین دسته‌بندی کرده است",
  "Why you're seeing this": "دلیل نمایش این درخواست",
  read: "خواندن",
  interaction: "تعامل",
  sensitive: "حساس",
  destructive: "مخرب",
  Deny: "رد کردن",
  "Allow once": "اجازه برای یک بار",
  "Always allow": "همیشه اجازه بده",
  "OpenUse configuration": "پیکربندی OpenUse",
  "Close Settings": "بستن تنظیمات",
  "Settings sections": "بخش‌های تنظیمات",
  AI: "هوش مصنوعی",
  "Models and providers": "مدل‌ها و ارائه‌دهنده‌ها",
  Appearance: "ظاهر",
  "Color and material": "رنگ و مادهٔ پنجره",
  "Spend recorded locally": "مصرف ثبت‌شده در دستگاه",
  Permissions: "مجوزها",
  "Apps OpenUse may control": "برنامه‌هایی که OpenUse می‌تواند کنترل کند",
  Advanced: "پیشرفته",
  "Runtime diagnostics": "عیب‌یابی اجرا",
  "Choose how OpenUse thinks.": "نحوهٔ فکر کردن OpenUse را انتخاب کنید.",
  "{count} models / {source}": "{count} مدل / {source}",
  live: "زنده",
  cached: "ذخیره‌شده",
  fallback: "پشتیبان",
  "models": "مدل",
  "Vercel AI Gateway": "درگاه هوش مصنوعی Vercel",
  "Custom endpoint": "نقطهٔ اتصال سفارشی",
  "Computer Use model": "مدل کنترل رایانه",
  "Refreshing...": "در حال تازه‌سازی...",
  "Refresh catalog": "تازه‌سازی فهرست",
  "Showing models that advertise both tool calling and visual input. The catalog is validated and cached locally.": "مدل‌هایی نمایش داده می‌شوند که هم فراخوانی ابزار و هم ورودی تصویری را اعلام کرده‌اند. فهرست بررسی و به‌صورت محلی ذخیره می‌شود.",
  "API key": "کلید API",
  "Key saved - enter a new key to replace it": "کلید ذخیره شده است. برای جایگزینی، کلید جدید را وارد کنید",
  "Paste your AI_GATEWAY_API_KEY": "AI_GATEWAY_API_KEY را جای‌گذاری کنید",
  "Stored locally with OS-backed encryption. Never returned to the renderer.": "با رمزگذاری سیستم‌عامل، به‌صورت محلی ذخیره می‌شود و هرگز به رابط کاربری برگردانده نمی‌شود.",
  "Testing...": "در حال آزمایش...",
  "Test connection": "آزمایش اتصال",
  "Save Gateway settings": "ذخیرهٔ تنظیمات درگاه",
  "Endpoint preset": "پیش‌تنظیم نقطهٔ اتصال",
  "Base URL": "نشانی پایه",
  "Model ID": "شناسهٔ مدل",
  "OpenAI-compatible chat completions endpoint. OpenUse does not infer local model capabilities.": "نقطهٔ اتصال تکمیل گفت‌وگوی سازگار با OpenAI. OpenUse قابلیت‌های مدل محلی را حدس نمی‌زند.",
  optional: "اختیاری",
  "Leave blank for local servers": "برای سرورهای محلی خالی بگذارید",
  "Declare endpoint capabilities": "قابلیت‌های نقطهٔ اتصال را مشخص کنید",
  "Visual input": "ورودی تصویری",
  "Required for Computer Use": "برای کنترل رایانه لازم است",
  "Configurable reasoning": "استدلال قابل تنظیم",
  "Allows reasoning controls": "کنترل سطح استدلال را فعال می‌کند",
  "Custom endpoints do not provide trusted pricing metadata. Cost is shown as unknown.": "نقاط اتصال سفارشی اطلاعات قیمت‌گذاری قابل اعتماد ارائه نمی‌کنند. هزینه به‌صورت نامشخص نمایش داده می‌شود.",
  "Use custom endpoint": "استفاده از نقطهٔ اتصال سفارشی",
  "Reasoning level": "سطح استدلال",
  "Only levels advertised by the selected model are sent. Unsupported choices fall back to Provider default.": "فقط سطح‌هایی که مدل انتخاب‌شده اعلام کرده است ارسال می‌شوند. گزینه‌های پشتیبانی‌نشده به پیش‌فرض ارائه‌دهنده برمی‌گردند.",
  "One signal color. A window that recedes.": "یک رنگ برای اقدام. پنجره‌ای که کنار می‌رود.",
  "OpenUse uses black, white, and one selected primary. The native material lets the desktop remain present while controls stay crisp.": "OpenUse از سیاه، سفید و یک رنگ اصلی انتخاب‌شده استفاده می‌کند. مادهٔ بومی اجازه می‌دهد دسکتاپ دیده شود و کنترل‌ها واضح بمانند.",
  "Primary color": "رنگ اصلی",
  "Use {color}": "استفاده از {color}",
  "Custom primary color": "رنگ اصلی سفارشی",
  "Background blur": "میزان تاری پس‌زمینه",
  "Background opacity": "شفافیت پس‌زمینه",
  "Show OpenUse cursor": "نمایش نشانگر OpenUse",
  "Show the virtual target overlay while the agent acts.": "نمایش پوشش هدف مجازی هنگام کار عامل.",
  Language: "زبان",
  English: "انگلیسی",
  Persian: "فارسی",
  "Language changes apply immediately to the whole interface.": "تغییر زبان فوراً روی تمام رابط کاربری اعمال می‌شود.",
  "Spend recorded through this installation.": "مصرف ثبت‌شده از طریق این نصب.",
  "Known spend": "هزینهٔ شناخته‌شده",
  "Completed tasks": "وظایف تکمیل‌شده",
  "Input tokens": "توکن‌های ورودی",
  "Output tokens": "توکن‌های خروجی",
  "Average task": "میانگین هر وظیفه",
  "Unpriced requests": "درخواست‌های بدون قیمت",
  "Only model IDs, token counts, action counts, timing, status, reasoning level, and known cost are stored. Commands, screenshots, accessibility content, credentials, and chain-of-thought are not written.": "فقط شناسهٔ مدل، تعداد توکن‌ها و عملیات، زمان، وضعیت، سطح استدلال و هزینهٔ شناخته‌شده ذخیره می‌شود. دستورها، تصاویر صفحه، محتوای دسترسی‌پذیری، اطلاعات ورود و زنجیرهٔ فکر نوشته نمی‌شوند.",
  "Recent model usage": "مصرف اخیر مدل‌ها",
  "Where requests are going": "درخواست‌ها به کجا می‌روند",
  "Usage appears after the first model request.": "مصرف پس از نخستین درخواست مدل نمایش داده می‌شود.",
  "{provider} / {count} requests": "{provider} / {count} درخواست",
  "Reset local usage history? This cannot be undone.": "سابقهٔ مصرف محلی پاک شود؟ این کار برگشت‌پذیر نیست.",
  "Reset local usage history": "پاک کردن سابقهٔ مصرف محلی",
  "Who can OpenUse control?": "OpenUse چه برنامه‌هایی را می‌تواند کنترل کند؟",
  "App permissions apply to semantic actions, coordinate fallback, screenshots, and keyboard input. Safety risk still determines whether a confirmation is required.": "مجوزهای برنامه برای عملیات معنایی، جایگزین مختصات، تصاویر صفحه و ورودی صفحه‌کلید اعمال می‌شوند. سطح خطر همچنان تعیین می‌کند که تأیید لازم است یا نه.",
  "Control allowed": "کنترل مجاز است",
  "Control blocked": "کنترل مسدود است",
  "Ask each time": "هر بار بپرس",
  "Runtime details.": "جزئیات اجرا.",
  Provider: "ارائه‌دهنده",
  Catalog: "فهرست مدل‌ها",
  Cursor: "نشانگر",
  "Visible during tasks": "هنگام وظایف قابل مشاهده",
  Hidden: "پنهان",
  Storage: "ذخیره‌سازی",
  "Local, atomic, privacy-safe": "محلی، اتمیک و امن از نظر حریم خصوصی",
  "Run native self-test": "اجرای خودآزمایی بومی",
  "Runtime information stays in the local process.": "اطلاعات اجرا در فرایند محلی باقی می‌ماند.",
  "Custom endpoint: {url}": "نقطهٔ اتصال سفارشی: {url}",
  "Safety boundaries": "مرزهای ایمنی",
  "OpenUse does not expose arbitrary shells, unrestricted filesystems, credential capture, hidden remote access, or software installation to the model.": "OpenUse پوستهٔ فرمان دلخواه، فایل‌سیستم بدون محدودیت، دریافت اطلاعات ورود، دسترسی پنهان از راه دور یا نصب نرم‌افزار را در اختیار مدل نمی‌گذارد.",
  "Open Accessibility settings": "باز کردن تنظیمات دسترسی‌پذیری",
  "Open Screen Recording settings": "باز کردن تنظیمات ضبط صفحه",
  "Gateway key configured": "کلید درگاه تنظیم شده است",
  "Gateway key needed": "کلید درگاه لازم است",
  "Custom endpoint selected": "نقطهٔ اتصال سفارشی انتخاب شده است",
  "Codex subscription": "اشتراک Codex",
  "Claude subscription": "اشتراک Claude",
  "OpenCode subscription": "اشتراک OpenCode",
  "AI providers": "ارائه‌دهندگان هوش مصنوعی",
  "Use your existing local subscription": "از اشتراک محلی موجود خود استفاده کنید",
  "OpenUse starts the signed-in local runtime and gives it only the guarded OpenUse computer tools. Credentials remain with the provider CLI.": "OpenUse اجرای محلیِ واردشده را راه‌اندازی می‌کند و فقط ابزارهای محافظت‌شدهٔ رایانهٔ OpenUse را در اختیار آن می‌گذارد. اطلاعات ورود نزد خط فرمان ارائه‌دهنده باقی می‌ماند.",
  "Check whether the local runtime is installed and authenticated.": "بررسی کنید اجرای محلی نصب و احراز هویت شده باشد.",
  "Detected version {version}": "نسخهٔ شناسایی‌شده {version}",
  "Not installed": "نصب نشده",
  "Sign-in required": "ورود لازم است",
  "Checking...": "در حال بررسی...",
  Unavailable: "در دسترس نیست",
  "Check connection": "بررسی اتصال",
  "Leave blank to use the model selected by the signed-in subscription runtime.": "برای استفاده از مدل انتخاب‌شده توسط اجرای اشتراک، این بخش را خالی بگذارید.",
  "Executable path": "مسیر فایل اجرایی",
  "Resolve from PATH": "شناسایی از PATH",
  "Use this only when the command is not discoverable from PATH.": "فقط وقتی استفاده کنید که فرمان از PATH پیدا نمی‌شود.",
  Install: "نصب",
  "Sign in": "ورود",
  "Save and use {provider}": "ذخیره و استفاده از {provider}",
  "Subscription connected": "اشتراک متصل است",
  "Subscription needs setup": "اشتراک نیازمند راه‌اندازی است",
  Done: "انجام شد",
  "Computer control setup": "راه‌اندازی کنترل رایانه",
  "OpenUse needs two macOS permissions.": "OpenUse به دو مجوز macOS نیاز دارد.",
  "These permissions stay under macOS control. OpenUse will not start a Computer Use task until both are granted.": "این مجوزها تحت کنترل macOS باقی می‌مانند. OpenUse تا زمان اعطای هر دو مجوز، وظیفهٔ کنترل رایانه را شروع نمی‌کند.",
  "Control buttons, fields, and windows semantically.": "دکمه‌ها، فیلدها و پنجره‌ها را به‌صورت معنایی کنترل کنید.",
  "Inspect the desktop when visual feedback is needed.": "هنگام نیاز به بازخورد تصویری، دسکتاپ را بررسی کنید.",
  "Grant both permissions in System Settings, then recheck.": "هر دو مجوز را در تنظیمات سیستم اعطا کنید و دوباره بررسی کنید.",
  Recheck: "بررسی دوباره",
  "Relaunch OpenUse": "راه‌اندازی دوبارهٔ OpenUse",
  Granted: "اعطا شده",
  "Not granted": "اعطا نشده",
  Unknown: "نامشخص",
  starting: "در حال شروع",
  stopped: "متوقف شده",
  unsupported: "پشتیبانی نمی‌شود",
  success: "موفق",
  failure: "ناموفق",
  origin: "مبدأ",
  "Input {price}": "ورودی {price}",
  "Output {price}": "خروجی {price}",
  "{result} / action {actionCount} / retry {retryCount}": "{result} / عمل {actionCount} / تلاش دوباره {retryCount}",
  "This model is not present in the current catalog.": "این مدل در فهرست فعلی وجود ندارد.",
  "It is not a language model.": "این مدل، زبانی نیست.",
  "It does not advertise tool calling.": "این مدل فراخوانی ابزار را اعلام نکرده است.",
  "It does not advertise visual input.": "این مدل ورودی تصویری را اعلام نکرده است.",
  "A screenshot will be sent to the selected model.": "یک تصویر صفحه برای مدل انتخاب‌شده ارسال می‌شود.",
  "OpenUse is reading a bounded accessibility view of this application.": "OpenUse یک نمای محدود دسترسی‌پذیری از این برنامه را می‌خواند.",
  "OpenUse is requesting control of this application.": "OpenUse درخواست کنترل این برنامه را دارد.",
  "OpenUse is bringing this application to the foreground.": "OpenUse این برنامه را به پیش‌زمینه می‌آورد.",
  "OpenUse is requesting a screen interaction.": "OpenUse درخواست تعامل با صفحه را دارد.",
  "OpenUse is locating the semantic control before interacting with it.": "OpenUse پیش از تعامل، کنترل معنایی را پیدا می‌کند.",
  "OpenUse is requesting a semantic UI interaction.": "OpenUse درخواست تعامل معنایی با رابط کاربری را دارد.",
  "This control may change or submit data.": "این کنترل ممکن است داده‌ای را تغییر دهد یا ارسال کند.",
  "OpenUse is checking the target control before typing.": "OpenUse پیش از تایپ، کنترل هدف را بررسی می‌کند.",
  "OpenUse is requesting text input; the text itself is not shown in the activity log.": "OpenUse درخواست ورود متن دارد؛ خود متن در گزارش فعالیت نمایش داده نمی‌شود.",
  "OpenUse is requesting a key interaction.": "OpenUse درخواست تعامل با یک کلید را دارد.",
  "This key may submit, delete, or change data.": "این کلید ممکن است داده‌ای را ارسال، حذف یا تغییر دهد.",
  "OpenUse is requesting a bounded scroll.": "OpenUse درخواست پیمایش محدود دارد.",
  "Search models or IDs": "جست‌وجوی مدل یا شناسه",
  "Search models": "جست‌وجوی مدل‌ها",
  "Computer Use only": "فقط مدل‌های کنترل رایانه",
  "Show all models": "نمایش همهٔ مدل‌ها",
  "All providers": "همهٔ ارائه‌دهنده‌ها",
  "No models match this search.": "مدلی با این جست‌وجو پیدا نشد.",
  "Provider default": "پیش‌فرض ارائه‌دهنده",
  "Pricing unavailable": "قیمت موجود نیست",
  "Unavailable for Computer Use: {reason}": "برای کنترل رایانه در دسترس نیست: {reason}",
  "Showing the first {count} matches.": "{count} نتیجهٔ نخست نمایش داده می‌شود.",
  "{count} models": "{count} مدل",
  "catalog {age}": "فهرست {age}",
  dated: "تاریخ‌دار",
  local: "محلی",
  "Known cost reported by the provider during this task and through this OpenUse installation": "هزینهٔ شناخته‌شده‌ای که ارائه‌دهنده در این وظیفه و از طریق این نصب OpenUse گزارش کرده است",
  "Approximate 20-step estimate based on recent local token usage and current catalog pricing. It is not a guarantee.": "برآورد تقریبی ۲۰ مرحله بر اساس مصرف اخیر توکن در دستگاه و قیمت فعلی فهرست مدل‌ها. این عدد تضمین‌شده نیست.",
  unavailable: "نامشخص",
  "Qualification mode": "حالت ارزیابی",
  "{platform} controller": "کنترل‌گر {platform}",
  Connected: "متصل",
  Offline: "آفلاین",
  PID: "PID",
  Heartbeat: "ضربان اتصال",
  "Last action": "آخرین عمل",
  "Self-test passed": "خودآزمایی موفق بود",
  "Self-test failed": "خودآزمایی ناموفق بود",
  monitor: "نمایشگر",
  monitors: "نمایشگر",
  Accessibility: "دسترسی‌پذیری",
  "Screen Recording": "ضبط صفحه",
  Display: "نمایشگر",
  Capture: "ثبت تصویر",
  "Last runtime observation": "آخرین مشاهدهٔ اجرا",
  action: "عمل",
  retry: "تلاش دوباره",
  Method: "روش",
  "not an interaction": "تعامل نیست",
  Element: "عنصر",
  Screenshot: "تصویر صفحه",
  "Normalized elements ({count})": "عناصر نرمال‌شده ({count})",
  "Normalized UI Automation elements": "عناصر نرمال‌شدهٔ خودکارسازی رابط کاربری",
  "(unnamed)": "(بدون نام)",
  "Start a task to inspect normalized UI state and actual interaction method here. Pixels are never persisted by default.": "برای بررسی وضعیت نرمال‌شدهٔ رابط کاربری و روش واقعی تعامل، یک وظیفه شروع کنید. پیکسل‌ها به‌صورت پیش‌فرض ذخیره نمی‌شوند.",
  "The task was stopped.": "وظیفه متوقف شد.",
  "The task ended.": "وظیفه پایان یافت.",
  "Unknown IPC sender.": "فرستندهٔ ناشناختهٔ IPC.",
  "Choose a model from the current Gateway catalog.": "مدلی را از فهرست فعلی درگاه انتخاب کنید.",
  "The native action failed.": "عمل بومی ناموفق بود.",
  "Text input sent; content omitted from logs.": "ورودی متنی ارسال شد؛ محتوا در گزارش‌ها ثبت نمی‌شود.",
  "Screenshot sent to the model for visual verification.": "تصویر صفحه برای تأیید بصری به مدل ارسال شد.",
  "Task marked complete by the agent.": "وظیفه توسط عامل تکمیل شد.",
  "Inspecting available applications": "در حال بررسی برنامه‌های موجود",
  "Inspecting open windows": "در حال بررسی پنجره‌های باز",
  "Inspecting the active window": "در حال بررسی پنجرهٔ فعال",
  "Capturing one screen observation": "در حال ثبت یک مشاهده از صفحه",
  "Focusing a window": "در حال تمرکز روی یک پنجره",
  "Clicking a screen position": "در حال کلیک روی نقطه‌ای از صفحه",
  "Double-clicking a screen position": "در حال دوبارکلیک روی نقطه‌ای از صفحه",
  "Typing text": "در حال تایپ متن",
  "Scrolling the application": "در حال پیمایش برنامه",
  "Waiting for the interface": "در انتظار رابط کاربری",
  "Verifying task completion": "در حال تأیید تکمیل وظیفه",
};

export function translate(locale: Locale, key: string, values: MessageValues = {}): string {
  const template = locale === "fa" ? faMessages[key] ?? key : key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    return value === undefined ? `{${name}}` : typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

export function formatNumber(locale: Locale, value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", options).format(value);
}

export function formatMoney(locale: Locale, value: number): string {
  const amount = Math.max(0, Number.isFinite(value) ? value : 0);
  if (locale === "fa") return `${formatNumber(locale, amount, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} دلار`;
  return `$${amount.toFixed(4)}`;
}

export function formatPricePerMillion(locale: Locale, price: number | undefined): string {
  if (price === undefined || !Number.isFinite(price)) return translate(locale, "Pricing unavailable");
  const amount = price * 1_000_000;
  const fractionDigits = amount >= 1 ? 2 : 4;
  if (locale === "fa") return `${formatNumber(locale, amount, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} دلار / ۱ میلیون توکن`;
  return `$${amount.toFixed(fractionDigits)} / 1M`;
}

export function formatTimestamp(locale: Locale, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

export function formatDuration(locale: Locale, durationMs: number): string {
  if (locale === "fa") return durationMs < 1000 ? `${formatNumber(locale, durationMs)} میلی‌ثانیه` : `${formatNumber(locale, durationMs / 1000, { maximumFractionDigits: 1 })} ثانیه`;
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

export function platformName(locale: Locale, platform: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "browser-preview") return translate(locale, "Browser preview");
  return platform === "unknown" ? translate(locale, "Desktop") : platform;
}

export function providerLabel(locale: Locale, provider: ProviderId): string {
  const labels: Record<ProviderId, string> = {
    "vercel-gateway": "Vercel AI Gateway",
    "custom-openai-compatible": "Custom endpoint",
    codex: "Codex subscription",
    claude: "Claude subscription",
    opencode: "OpenCode subscription",
  };
  return translate(locale, labels[provider]);
}

export function statusLabel(locale: Locale, status: AgentStatus): string {
  return translate(locale, status === "idle" ? "Ready" : status === "running" ? "Working" : status === "completed" ? "Completed" : status === "stopped" ? "Stopped" : "Needs attention");
}

export function reasoningLabel(locale: Locale, effort: ReasoningEffort): string {
  const key = effort === "provider-default" ? "Provider default" : effort === "xhigh" ? "XHigh" : effort[0].toUpperCase() + effort.slice(1);
  return locale === "fa" ? ({ "Provider default": "پیش‌فرض ارائه‌دهنده", None: "بدون استدلال", Minimal: "حداقلی", Low: "کم", Medium: "متوسط", High: "زیاد", XHigh: "بسیار زیاد" }[key] ?? key) : key;
}

export function starterCommands(locale: Locale, platform: string): string[] {
  if (locale === "fa") {
    return platform === "darwin"
      ? [
          "TextEdit را باز کن و «سلام از OpenUse» را تایپ کن",
          "ماشین‌حساب را باز کن و ۳۷ × ۱۹ را حساب کن",
          "TextEdit را باز کن، «فایل آزمایشی OpenUse» را تایپ کن و آن را با نام openuse-test.txt روی دسکتاپ ذخیره کن.",
        ]
      : [
          "نوت‌پد را باز کن و «سلام از OpenUse» را تایپ کن",
          "ماشین‌حساب را باز کن و ۳۷ × ۱۹ را حساب کن",
          "نوت‌پد را باز کن، «فایل آزمایشی OpenUse» را تایپ کن و آن را با نام openuse-test.txt روی دسکتاپ ذخیره کن.",
        ];
  }
  return platform === "darwin"
    ? [
        'Open TextEdit and type "Hello from OpenUse"',
        "Open Calculator and calculate 37 x 19",
        'Open TextEdit, type "OpenUse test file", and save it as openuse-test.txt on my Desktop.',
      ]
    : [
        'Open Notepad and type "Hello from OpenUse"',
        "Open Calculator and calculate 37 x 19",
        'Open Notepad, type "OpenUse test file", and save it as openuse-test.txt on my Desktop.',
      ];
}

export function localizeRuntimeText(locale: Locale, value: string | undefined): string | undefined {
  if (!value || locale === "en") return value;
  const exact = translate(locale, value);
  if (exact !== value) return exact;
  const opening = /^Opening (.+)$/.exec(value);
  if (opening) return `در حال باز کردن ${opening[1]}`;
  const inspecting = /^Inspect (.+)$/.exec(value);
  if (inspecting) return `در حال بررسی ${inspecting[1]}`;
  const focusing = /^Focus (.+)$/.exec(value);
  if (focusing) return `در حال تمرکز روی ${focusing[1]}`;
  const clicking = /^Clicking (.+)$/.exec(value);
  if (clicking) return `در حال کلیک روی ${clicking[1]}`;
  const click = /^Click (.+)$/.exec(value);
  if (click) return `کلیک روی ${click[1]}`;
  const clickAt = /^Click at (.+)$/.exec(value);
  if (clickAt) return `کلیک روی ${clickAt[1]}`;
  const doubleClick = /^Double-click(?:ing)?(?: at)? (.+)$/.exec(value);
  if (doubleClick) return `دوبارکلیک روی ${doubleClick[1]}`;
  const pressing = /^Pressing (.+)$/.exec(value);
  if (pressing) return `در حال فشردن ${pressing[1]}`;
  const press = /^Press (.+)$/.exec(value);
  if (press) return `فشردن ${press[1]}`;
  const typeInto = /^Type (.+) into (.+)$/.exec(value);
  if (typeInto) return `در حال وارد کردن متن در ${typeInto[2]}`;
  if (value === "Scroll the focused application") return "در حال پیمایش برنامهٔ متمرکز";
  const connected = /^The (.+) controller connected\.$/.exec(value);
  if (connected) return `کنترل‌گر ${connected[1]} متصل شد.`;
  const starting = /^Starting the (.+) controller\.$/.exec(value);
  if (starting) return `کنترل‌گر ${starting[1]} در حال شروع است.`;
  const offline = /^The (.+) controller is offline; it will be restarted on the next action\.$/.exec(value);
  if (offline) return `کنترل‌گر ${offline[1]} آفلاین است؛ در عمل بعدی دوباره راه‌اندازی می‌شود.`;
  return value;
}
