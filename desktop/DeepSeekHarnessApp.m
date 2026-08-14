#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *const DSHAppName = @"deepseek harness";

@interface DSHApplicationDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSTask *backendTask;
@property(nonatomic, strong) NSTask *accountTask;
@property(nonatomic, strong) NSFileHandle *logHandle;
@property(nonatomic, strong) NSMutableString *backendBuffer;
@property(nonatomic, strong) NSURL *backendURL;
@property(nonatomic) dispatch_queue_t backendQueue;
@property(nonatomic) BOOL quitting;
@end

@implementation DSHApplicationDelegate

- (instancetype)init {
  self = [super init];
  if (self) {
    _backendBuffer = [NSMutableString string];
    _backendQueue = dispatch_queue_create("ai.deepseek.harness.backend", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [self installMenu];
  [self buildWindow];
  [self startBackend];
  [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  self.quitting = YES;
  [self.accountTask terminate];
  [self.backendTask terminate];
  [self.logHandle closeFile];
}

- (NSURL *)resources {
  return NSBundle.mainBundle.resourceURL;
}

- (NSURL *)bundledNode {
  return [[self resources] URLByAppendingPathComponent:@"runtime/node"];
}

- (NSURL *)runtimeRoot {
  return [[self resources] URLByAppendingPathComponent:@"runtime/dsh" isDirectory:YES];
}

- (NSURL *)dshEntrypoint {
  return [[self runtimeRoot] URLByAppendingPathComponent:@"node_modules/@deepseek-ai/dsh/lib/bin.js"];
}

- (NSURL *)codexEntrypoint {
  return [[self runtimeRoot] URLByAppendingPathComponent:@"node_modules/@openai/codex/bin/codex.js"];
}

- (NSURL *)applicationSupportDirectory:(NSError **)error {
  NSURL *library = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory
                                                         inDomains:NSUserDomainMask].firstObject;
  NSURL *directory = [library URLByAppendingPathComponent:@"DeepSeek Harness" isDirectory:YES];
  if (![NSFileManager.defaultManager createDirectoryAtURL:directory
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:error]) return nil;
  return directory;
}

- (NSURL *)logFile:(NSError **)error {
  NSURL *library = [NSFileManager.defaultManager URLsForDirectory:NSLibraryDirectory
                                                         inDomains:NSUserDomainMask].firstObject;
  NSURL *directory = [library URLByAppendingPathComponent:@"Logs/DeepSeek Harness" isDirectory:YES];
  if (![NSFileManager.defaultManager createDirectoryAtURL:directory
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:error]) return nil;
  NSURL *file = [directory URLByAppendingPathComponent:@"backend.log"];
  if (![NSFileManager.defaultManager fileExistsAtPath:file.path]) {
    if (![NSFileManager.defaultManager createFileAtPath:file.path contents:nil attributes:nil]) {
      if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain
                                               code:NSFileWriteUnknownError
                                           userInfo:@{NSLocalizedDescriptionKey: @"无法创建后端日志文件"}];
      return nil;
    }
  }
  return file;
}

- (NSURL *)workspaceDirectory {
  NSURL *preferred = [NSURL fileURLWithPath:@"/Volumes/sirui" isDirectory:YES];
  BOOL isDirectory = NO;
  if ([NSFileManager.defaultManager fileExistsAtPath:preferred.path isDirectory:&isDirectory] && isDirectory) {
    return preferred;
  }
  return NSFileManager.defaultManager.homeDirectoryForCurrentUser;
}

- (NSDictionary<NSString *, NSString *> *)processEnvironment:(NSURL *)dshHome {
  NSMutableDictionary<NSString *, NSString *> *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  NSArray<NSString *> *paths = @[
    [[[self resources] URLByAppendingPathComponent:@"runtime"] path],
    [[[self runtimeRoot] URLByAppendingPathComponent:@"node_modules/.bin"] path],
    @"/opt/homebrew/bin", @"/usr/local/bin", @"/usr/bin", @"/bin", @"/usr/sbin", @"/sbin"
  ];
  environment[@"PATH"] = [paths componentsJoinedByString:@":"];
  environment[@"DSH_HOME"] = dshHome.path;
  environment[@"DSH_TELEMETRY_DISABLED"] = @"1";
  environment[@"DSH_TOOLS_MODE"] = @"both";
  return environment;
}

- (void)buildWindow {
  WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
  configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
  WKWebView *view = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
  view.navigationDelegate = self;
  [view setValue:@NO forKey:@"drawsBackground"];
  [view loadHTMLString:[self.class loadingHTML] baseURL:nil];

  NSWindow *window = [[NSWindow alloc]
    initWithContentRect:NSMakeRect(0, 0, 1240, 820)
              styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                        NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable |
                        NSWindowStyleMaskFullSizeContentView
                backing:NSBackingStoreBuffered
                  defer:NO];
  window.title = DSHAppName;
  window.titlebarAppearsTransparent = YES;
  window.minSize = NSMakeSize(880, 600);
  [window center];
  window.contentView = view;
  [window makeKeyAndOrderFront:nil];
  self.window = window;
  self.webView = view;
}

- (NSMenuItem *)menuItem:(NSString *)title action:(SEL)action key:(NSString *)key {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
  item.target = self;
  return item;
}

- (void)installMenu {
  NSMenu *main = [NSMenu new];
  NSMenuItem *appItem = [NSMenuItem new];
  [main addItem:appItem];
  NSMenu *appMenu = [NSMenu new];
  [appMenu addItem:[[NSMenuItem alloc] initWithTitle:[@"关于 " stringByAppendingString:DSHAppName]
                                              action:@selector(orderFrontStandardAboutPanel:)
                                       keyEquivalent:@""]];
  [appMenu addItem:NSMenuItem.separatorItem];
  [appMenu addItem:[self menuItem:@"Codex 账号登录…" action:@selector(signInCodex:) key:@"l"]];
  [appMenu addItem:[self menuItem:@"Codex 登录状态" action:@selector(codexStatus:) key:@""]];
  [appMenu addItem:NSMenuItem.separatorItem];
  [appMenu addItem:[self menuItem:@"显示后端日志" action:@selector(showLogs:) key:@""]];
  [appMenu addItem:NSMenuItem.separatorItem];
  [appMenu addItem:[[NSMenuItem alloc] initWithTitle:[@"退出 " stringByAppendingString:DSHAppName]
                                              action:@selector(terminate:)
                                       keyEquivalent:@"q"]];
  appItem.submenu = appMenu;

  NSMenuItem *viewItem = [NSMenuItem new];
  [main addItem:viewItem];
  NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"显示"];
  [viewMenu addItem:[self menuItem:@"重新载入" action:@selector(reload:) key:@"r"]];
  viewItem.submenu = viewMenu;
  NSApp.mainMenu = main;
}

- (BOOL)ensureCodexProfileFallback:(NSURL *)dshHome error:(NSError **)error {
  NSFileManager *manager = NSFileManager.defaultManager;
  NSURL *source = [[self runtimeRoot]
    URLByAppendingPathComponent:@"node_modules/@deepseek-ai/dsh-subagent-codex" isDirectory:YES];
  BOOL sourceIsDirectory = NO;
  if (![manager fileExistsAtPath:source.path isDirectory:&sourceIsDirectory] || !sourceIsDirectory) {
    if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain
                                             code:NSFileNoSuchFileError
                                         userInfo:@{NSLocalizedDescriptionKey: @"App 内缺少 Codex 子代理运行时"}];
    return NO;
  }

  NSURL *scope = [dshHome URLByAppendingPathComponent:@"profiles/node_modules/@deepseek-ai" isDirectory:YES];
  if (![manager createDirectoryAtURL:scope withIntermediateDirectories:YES attributes:nil error:error]) return NO;
  NSURL *link = [scope URLByAppendingPathComponent:@"dsh-subagent-codex"];
  NSError *attributesError = nil;
  NSDictionary<NSFileAttributeKey, id> *attributes = [manager attributesOfItemAtPath:link.path
                                                                                error:&attributesError];
  if (attributes) {
    if (![attributes[NSFileType] isEqual:NSFileTypeSymbolicLink]) {
      if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain
                                               code:NSFileWriteFileExistsError
                                           userInfo:@{NSLocalizedDescriptionKey:
                                             @"Codex Profile fallback 已存在且不是 App 可维护的链接"}];
      return NO;
    }
    NSString *destination = [manager destinationOfSymbolicLinkAtPath:link.path error:error];
    if (!destination) return NO;
    if ([destination isEqualToString:source.path]) return YES;
    if (![manager removeItemAtURL:link error:error]) return NO;
  } else if (![attributesError.domain isEqualToString:NSCocoaErrorDomain]
             || (attributesError.code != NSFileNoSuchFileError
                 && attributesError.code != NSFileReadNoSuchFileError)) {
    if (error) *error = attributesError;
    return NO;
  }
  return [manager createSymbolicLinkAtURL:link withDestinationURL:source error:error];
}

- (void)startBackend {
  NSError *error = nil;
  NSURL *dshHome = [self applicationSupportDirectory:&error];
  if (dshHome && ![self ensureCodexProfileFallback:dshHome error:&error]) dshHome = nil;
  NSURL *logURL = dshHome ? [self logFile:&error] : nil;
  if (!dshHome || !logURL) {
    [self showFailure:[NSString stringWithFormat:@"无法准备 Harness 数据目录：%@", error.localizedDescription]];
    return;
  }
  self.logHandle = [NSFileHandle fileHandleForWritingToURL:logURL error:&error];
  [self.logHandle seekToEndOfFile];
  if (!self.logHandle) {
    [self showFailure:[NSString stringWithFormat:@"无法打开 Harness 日志：%@", error.localizedDescription]];
    return;
  }

  NSTask *task = [NSTask new];
  task.executableURL = [self bundledNode];
  task.currentDirectoryURL = [self workspaceDirectory];
  task.environment = [self processEnvironment:dshHome];
  task.arguments = @[
    [[self dshEntrypoint] path],
    @"web", @"--patch",
    [[[self resources] URLByAppendingPathComponent:@"config/openai.cordis.patch.yml"] path],
    @"--port", @"0"
  ];

  NSPipe *standardOutput = [NSPipe pipe];
  NSPipe *standardError = [NSPipe pipe];
  task.standardOutput = standardOutput;
  task.standardError = standardError;
  __weak typeof(self) weakSelf = self;
  standardOutput.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    [weakSelf consumeBackend:handle.availableData];
  };
  standardError.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    [weakSelf consumeBackend:handle.availableData];
  };
  task.terminationHandler = ^(NSTask *finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self || self.quitting) return;
      [self showFailure:[NSString stringWithFormat:
        @"Harness 后端已退出（状态 %d）。请从菜单打开后端日志查看详情。",
        finished.terminationStatus]];
    });
  };
  self.backendTask = task;
  if (![task launchAndReturnError:&error]) {
    [self showFailure:[NSString stringWithFormat:@"无法启动 Harness 后端：%@", error.localizedDescription]];
  }
}

- (void)consumeBackend:(NSData *)data {
  if (data.length == 0) return;
  __weak typeof(self) weakSelf = self;
  dispatch_async(self.backendQueue, ^{
    typeof(self) self = weakSelf;
    if (!self) return;
    [self.logHandle writeData:data];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!text) return;
    [self.backendBuffer appendString:text];
    if (self.backendBuffer.length > 64000) {
      [self.backendBuffer deleteCharactersInRange:NSMakeRange(0, self.backendBuffer.length - 32000)];
    }
    if (self.backendURL) return;
    NSRegularExpression *regex = [NSRegularExpression
      regularExpressionWithPattern:@"https?://(?:127\\.0\\.0\\.1|localhost):[0-9]+"
                           options:0
                             error:nil];
    NSTextCheckingResult *match = [regex firstMatchInString:self.backendBuffer
                                                   options:0
                                                     range:NSMakeRange(0, self.backendBuffer.length)];
    if (!match) return;
    self.backendURL = [NSURL URLWithString:[self.backendBuffer substringWithRange:match.range]];
    NSURL *url = self.backendURL;
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf.webView loadRequest:[NSURLRequest requestWithURL:url]];
    });
  });
}

- (void)reload:(id)sender {
  if (self.backendURL) {
    [self.webView loadRequest:[NSURLRequest requestWithURL:self.backendURL]];
  } else {
    [self.webView reload];
  }
}

- (void)showLogs:(id)sender {
  NSError *error = nil;
  NSURL *file = [self logFile:&error];
  if (file) [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[file]];
}

- (void)signInCodex:(id)sender {
  [self runCodex:@[@"login"] title:@"Codex 账号登录"];
}

- (void)codexStatus:(id)sender {
  [self runCodex:@[@"login", @"status"] title:@"Codex 登录状态"];
}

- (void)runCodex:(NSArray<NSString *> *)arguments title:(NSString *)title {
  if (self.accountTask) {
    [self showFailure:@"已有 Codex 账号操作正在进行。"];
    return;
  }
  NSError *error = nil;
  NSURL *dshHome = [self applicationSupportDirectory:&error];
  if (!dshHome) {
    [self showFailure:error.localizedDescription];
    return;
  }
  NSTask *task = [NSTask new];
  task.executableURL = [self bundledNode];
  task.arguments = [@[[self codexEntrypoint].path] arrayByAddingObjectsFromArray:arguments];
  task.currentDirectoryURL = [self workspaceDirectory];
  task.environment = [self processEnvironment:dshHome];
  NSPipe *output = [NSPipe pipe];
  task.standardOutput = output;
  task.standardError = output;
  task.standardInput = [NSFileHandle fileHandleWithNullDevice];
  __weak typeof(self) weakSelf = self;
  task.terminationHandler = ^(NSTask *finished) {
    NSData *data = [output.fileHandleForReading readDataToEndOfFile];
    NSString *message = [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
      stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self) return;
      self.accountTask = nil;
      [self showInformation:title message:message.length ? message : @"操作已结束。"];
    });
  };
  self.accountTask = task;
  if (![task launchAndReturnError:&error]) {
    self.accountTask = nil;
    [self showFailure:[NSString stringWithFormat:@"无法启动 Codex：%@", error.localizedDescription]];
  }
}

- (void)showFailure:(NSString *)message {
  NSAlert *alert = [NSAlert new];
  alert.alertStyle = NSAlertStyleCritical;
  alert.messageText = DSHAppName;
  alert.informativeText = message ?: @"未知错误";
  [alert runModal];
}

- (void)showInformation:(NSString *)title message:(NSString *)message {
  NSAlert *alert = [NSAlert new];
  alert.alertStyle = NSAlertStyleInformational;
  alert.messageText = title;
  alert.informativeText = message;
  [alert runModal];
}

+ (NSString *)loadingHTML {
  return @"<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
    "<style>html,body{height:100%;margin:0;background:#090b10;color:#dce4ff;"
    "font:15px -apple-system,BlinkMacSystemFont,sans-serif}main{height:100%;display:grid;"
    "place-items:center;text-align:center}.fish{font-size:54px;color:#4d6bfe;margin-bottom:18px}"
    ".sub{color:#7d879e;margin-top:9px}</style><main><div><div class='fish'>◖°⌁°◗</div>"
    "<div>正在启动 deepseek harness…</div><div class='sub'>OpenAI Responses · GPT-5.6 Sol</div>"
    "</div></main></html>";
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication;
    DSHApplicationDelegate *delegate = [DSHApplicationDelegate new];
    app.delegate = delegate;
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    [app run];
    (void)delegate;
  }
  return 0;
}
