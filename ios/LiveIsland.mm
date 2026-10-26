#import <LiveIslandSpec/LiveIslandSpec.h>

#if __has_include(<LiveIsland/LiveIsland-Swift.h>)
#import <LiveIsland/LiveIsland-Swift.h>
#else
#import "LiveIsland-Swift.h"
#endif

/// TurboModule "LiveIsland": a thin ObjC++ shell over LiveIslandImpl.swift (ActivityKit is Swift-only).
@interface LiveIsland : NativeLiveIslandSpecBase <NativeLiveIslandSpec>
@end

@implementation LiveIsland {
  LiveIslandImpl *_impl;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _impl = [LiveIslandImpl new];
    __weak LiveIsland *weakSelf = self;
    _impl.emit = ^(NSString *event, NSDictionary *body) {
      LiveIsland *strongSelf = weakSelf;
      if (strongSelf == nil) {
        return;
      }
      if ([event isEqualToString:@"onActivityStateChange"]) {
        [strongSelf emitOnActivityStateChange:body];
      } else if ([event isEqualToString:@"onPushToken"]) {
        [strongSelf emitOnPushToken:body];
      } else if ([event isEqualToString:@"onPushToStartToken"]) {
        [strongSelf emitOnPushToStartToken:body];
      }
    };
  }
  return self;
}

// Emitting before the callback exists would call an empty std::function, so only start
// following activities once React Native has wired the emitter.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];
  [_impl startObserving];
}

- (NSNumber *)areActivitiesEnabled
{
  return @([_impl areActivitiesEnabled]);
}

- (void)startActivity:(NSString *)name
              payload:(NSString *)payload
              options:(NSDictionary *)options
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [_impl startActivity:name payload:payload options:options resolve:resolve reject:reject];
}

- (void)updateActivity:(NSString *)id
               payload:(NSString *)payload
               options:(NSDictionary *)options
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [_impl updateActivity:id payload:payload options:options resolve:resolve reject:reject];
}

- (void)endActivity:(NSString *)id
            payload:(NSString *_Nullable)payload
            options:(NSDictionary *)options
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [_impl endActivity:id payload:payload options:options resolve:resolve reject:reject];
}

- (void)endAllActivities:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl endAllActivities:resolve reject:reject];
}

- (NSArray<NSDictionary *> *)getActivities
{
  return [_impl getActivities];
}

// Custom notification views are an Android concern; Live Activities are drawn by the widget.
- (NSDictionary *)getNotificationHealth
{
  return @{@"customViews" : @"allowed"};
}

// Android-only features: the system draws the Dynamic Island on iOS.
- (NSNumber *)hasOverlayPermission
{
  return @NO;
}

- (void)requestOverlayPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(nil);
}

- (void)requestNotificationPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(@([_impl areActivitiesEnabled]));
}

- (NSString *_Nullable)iconImage:(NSString *)name android:(NSString *_Nullable)android size:(double)size color:(double)color
{
  return [_impl iconImage:name size:size color:color];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeLiveIslandSpecJSI>(params);
}

@end
