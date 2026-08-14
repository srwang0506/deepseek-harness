#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *const DSHAppName = @"deepseek harness";

@interface DSHApplicationDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler>
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

- (NSURL *)openAIOAuthEntrypoint {
  return [[self runtimeRoot] URLByAppendingPathComponent:@"openai-oauth.mjs"];
}

- (NSURL *)openAIAuthBridge {
  return [[self resources] URLByAppendingPathComponent:@"openai-auth-bridge.js"];
}

- (NSURL *)applicationSupportDirectory:(NSError **)error {
  NSURL *library = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory
                                                         inDomains:NSUserDomainMask].firstObject;
  NSURL *directory = [library URLByAppendingPathComponent:@"DeepSeek Harness" isDirectory:YES];
  NSDictionary<NSFileAttributeKey, id> *attributes = @{NSFilePosixPermissions: @0700};
  if (![NSFileManager.defaultManager createDirectoryAtURL:directory
                              withIntermediateDirectories:YES
                                               attributes:attributes
                                                    error:error]) return nil;
  if (![NSFileManager.defaultManager setAttributes:attributes ofItemAtPath:directory.path error:error]) return nil;
  return directory;
}

- (NSURL *)openAICredentialFile:(NSURL *)dshHome {
  return [dshHome URLByAppendingPathComponent:@"pi-ai-auth.json"];
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
  NSURL *preferred = [NSURL fileURLWithPath:@"/Volumes/sirui/deepseek-harness" isDirectory:YES];
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
  environment[@"DSH_CWD"] = [self workspaceDirectory].path;
  environment[@"DSH_TELEMETRY_DISABLED"] = @"1";
  environment[@"DSH_TOOLS_MODE"] = @"both";
  return environment;
}

- (void)buildWindow {
  WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
  configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
  NSError *bridgeError = nil;
  NSString *bridge = [NSString stringWithContentsOfURL:[self openAIAuthBridge]
                                              encoding:NSUTF8StringEncoding
                                                 error:&bridgeError];
  if (!bridge) {
    [self showFailure:[NSString stringWithFormat:@"无法加载 OpenAI 登录界面：%@", bridgeError.localizedDescription]];
    return;
  }
  [configuration.userContentController addScriptMessageHandler:self name:@"openAIAuth"];
  [configuration.userContentController addUserScript:[[WKUserScript alloc]
    initWithSource:bridge
     injectionTime:WKUserScriptInjectionTimeAtDocumentStart
  forMainFrameOnly:YES]];
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
  [appMenu addItem:[self menuItem:@"OpenAI 登录或切换方式…" action:@selector(signInOpenAI:) key:@"l"]];
  [appMenu addItem:[self menuItem:@"OpenAI 登录状态" action:@selector(openAIStatus:) key:@""]];
  [appMenu addItem:[self menuItem:@"退出 OpenAI" action:@selector(signOutOpenAI:) key:@""]];
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

- (void)startBackend {
  NSError *error = nil;
  NSURL *dshHome = [self applicationSupportDirectory:&error];
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
  // Keep the process cwd on APFS. Finder-launched processes can block in
  // getcwd() when their physical cwd is an exFAT volume; DSH_CWD above carries
  // the independently configured logical workspace into every Harness layer.
  task.currentDirectoryURL = NSFileManager.defaultManager.homeDirectoryForCurrentUser;
  task.environment = [self processEnvironment:dshHome];
  task.arguments = @[
    [self dshEntrypoint].path,
    @"web", @"--patch",
    [[[self resources] URLByAppendingPathComponent:@"config/desktop.cordis.patch.yml"] path],
    @"--port", @"0"
  ];

  NSPipe *standardOutput = [NSPipe pipe];
  NSPipe *standardError = [NSPipe pipe];
  task.standardInput = [NSFileHandle fileHandleWithNullDevice];
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

- (void)signInOpenAI:(id)sender {
  [self.webView evaluateJavaScript:@"window.deepseekHarnessOpenAI?.showLogin()" completionHandler:nil];
}

- (void)openAIStatus:(id)sender {
  [self runOpenAIOAuthCommand:@"status" title:@"OpenAI 登录状态"];
}

- (void)signOutOpenAI:(id)sender {
  [self runOpenAIOAuthCommand:@"logout" title:@"退出 OpenAI"];
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
  if (![message.name isEqualToString:@"openAIAuth"] || message.webView != self.webView
      || ![message.body isKindOfClass:NSDictionary.class]) return;
  NSURL *pageURL = message.webView.URL;
  if (!self.backendURL || ![pageURL.host isEqualToString:self.backendURL.host]
      || ![pageURL.port isEqualToNumber:self.backendURL.port]) return;
  NSDictionary *body = message.body;
  NSString *requestId = [body[@"requestId"] isKindOfClass:NSString.class] ? body[@"requestId"] : nil;
  NSString *command = [body[@"command"] isKindOfClass:NSString.class] ? body[@"command"] : nil;
  if (!requestId || !command) return;
  if (self.accountTask) {
    [self replyOpenAIRequest:requestId success:NO value:@{ @"message": @"已有 OpenAI 登录操作正在进行。" }];
    return;
  }

  NSArray<NSString *> *arguments = nil;
  NSString *secret = nil;
  if ([command isEqualToString:@"status"]) {
    arguments = @[ @"status-json" ];
  } else if ([command isEqualToString:@"login"]) {
    NSString *method = [body[@"method"] isKindOfClass:NSString.class] ? body[@"method"] : nil;
    NSSet<NSString *> *methods = [NSSet setWithArray:@[ @"browser", @"device", @"api-key" ]];
    if (!method || ![methods containsObject:method]) {
      [self replyOpenAIRequest:requestId success:NO value:@{ @"message": @"未知的 OpenAI 登录方式。" }];
      return;
    }
    if ([method isEqualToString:@"api-key"]) {
      secret = [body[@"apiKey"] isKindOfClass:NSString.class] ? body[@"apiKey"] : nil;
      if (!secret.length) {
        [self replyOpenAIRequest:requestId success:NO value:@{ @"message": @"OpenAI API Key 不能为空。" }];
        return;
      }
    }
    arguments = @[ @"login", method ];
  } else {
    [self replyOpenAIRequest:requestId success:NO value:@{ @"message": @"不支持的 OpenAI 登录操作。" }];
    return;
  }
  [self runOpenAIBridgeArguments:arguments requestId:requestId secret:secret];
}

- (void)runOpenAIBridgeArguments:(NSArray<NSString *> *)arguments
                       requestId:(NSString *)requestId
                          secret:(NSString *)secret {
  NSError *error = nil;
  NSURL *dshHome = [self applicationSupportDirectory:&error];
  if (!dshHome) {
    [self replyOpenAIRequest:requestId success:NO value:@{ @"message": error.localizedDescription ?: @"无法准备凭据目录。" }];
    return;
  }
  NSTask *task = [NSTask new];
  task.executableURL = [self bundledNode];
  NSMutableArray<NSString *> *taskArguments = [NSMutableArray arrayWithObjects:
    [self openAIOAuthEntrypoint].path, arguments.firstObject, [self openAICredentialFile:dshHome].path, nil];
  if (arguments.count > 1) [taskArguments addObject:arguments[1]];
  task.arguments = taskArguments;
  task.currentDirectoryURL = NSFileManager.defaultManager.homeDirectoryForCurrentUser;
  task.environment = [self processEnvironment:dshHome];
  NSPipe *output = [NSPipe pipe];
  task.standardOutput = output;
  task.standardError = output;
  NSPipe *input = nil;
  if (secret) {
    input = [NSPipe pipe];
    task.standardInput = input;
  } else {
    task.standardInput = [NSFileHandle fileHandleWithNullDevice];
  }
  __weak typeof(self) weakSelf = self;
  BOOL wantsStatus = [arguments.firstObject isEqualToString:@"status-json"];
  task.terminationHandler = ^(NSTask *finished) {
    NSData *data = [output.fileHandleForReading readDataToEndOfFile];
    NSString *message = [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
      stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self) return;
      self.accountTask = nil;
      if (finished.terminationStatus != 0) {
        [self replyOpenAIRequest:requestId success:NO value:@{
          @"message": message.length ? message : @"OpenAI 登录操作失败。"
        }];
        return;
      }
      if (!wantsStatus) {
        [self replyOpenAIRequest:requestId success:YES value:@{ @"message": message ?: @"" }];
        return;
      }
      NSData *jsonData = [message dataUsingEncoding:NSUTF8StringEncoding];
      NSDictionary *status = jsonData ? [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil] : nil;
      if (![status isKindOfClass:NSDictionary.class]) {
        [self replyOpenAIRequest:requestId success:NO value:@{ @"message": @"无法读取 OpenAI 登录状态。" }];
        return;
      }
      [self replyOpenAIRequest:requestId success:YES value:status];
    });
  };
  self.accountTask = task;
  if (![task launchAndReturnError:&error]) {
    self.accountTask = nil;
    [self replyOpenAIRequest:requestId success:NO value:@{ @"message": error.localizedDescription ?: @"无法启动 OpenAI 登录。" }];
    return;
  }
  if (secret) {
    [input.fileHandleForWriting writeData:[secret dataUsingEncoding:NSUTF8StringEncoding]];
    [input.fileHandleForWriting closeFile];
  }
}

- (void)replyOpenAIRequest:(NSString *)requestId success:(BOOL)success value:(NSDictionary *)value {
  NSData *requestData = [NSJSONSerialization dataWithJSONObject:requestId options:0 error:nil];
  NSData *valueData = [NSJSONSerialization dataWithJSONObject:value ?: @{} options:0 error:nil];
  if (!requestData || !valueData) return;
  NSString *requestJSON = [[NSString alloc] initWithData:requestData encoding:NSUTF8StringEncoding];
  NSString *valueJSON = [[NSString alloc] initWithData:valueData encoding:NSUTF8StringEncoding];
  NSString *script = [NSString stringWithFormat:
    @"window.__deepseekHarnessOpenAIAuthReply?.(%@,%@,%@)",
    requestJSON, success ? @"true" : @"false", valueJSON];
  [self.webView evaluateJavaScript:script completionHandler:nil];
}

- (void)runOpenAIOAuthCommand:(NSString *)command title:(NSString *)title {
  if (self.accountTask) {
    [self showFailure:@"已有 OpenAI 登录操作正在进行。"];
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
  task.arguments = @[
    [self openAIOAuthEntrypoint].path,
    command,
    [self openAICredentialFile:dshHome].path
  ];
  task.currentDirectoryURL = NSFileManager.defaultManager.homeDirectoryForCurrentUser;
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
    [self showFailure:[NSString stringWithFormat:@"无法启动 OpenAI 登录操作：%@", error.localizedDescription]];
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
    "<div>正在启动 deepseek harness…</div><div class='sub'>默认 DeepSeek · 可选 OpenAI GPT</div>"
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
