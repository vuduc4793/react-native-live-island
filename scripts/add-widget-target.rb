#!/usr/bin/env ruby
# Adds (or refreshes) the Live Activity widget extension in a bare React Native iOS project.
#
#   ruby node_modules/react-native-live-island/scripts/add-widget-target.rb ios/MyApp.xcodeproj [options]
#
#   --app-target NAME   app target to embed the widget in (default: the first iOS application target)
#   --name NAME         widget target name (default: DynamicIslandWidget)
#   --push              also add LiveIsland_EnablePush to the app Info.plist(s) (push tokens; needs aps-environment)
#
# What it does, for every build configuration of the app target (Debug/Release/Staging/...):
#   - creates the app-extension target, iOS 16.2, compiling the library's ios-widget/*.swift in place
#     (files are referenced from node_modules, so upgrading the library upgrades the widget);
#   - bundle id = <app bundle id of that configuration>.<name>; team / signing style / versions copied from the app;
#   - embeds the .appex in the app ("Embed Foundation Extensions") and adds a target dependency;
#   - sets NSSupportsLiveActivities = YES in each app Info.plist.
# Safe to re-run: an existing target with the same name is updated, not duplicated.
# Uses the xcodeproj gem, which ships with CocoaPods.

require 'optparse'
require 'pathname'
require 'xcodeproj'

options = { name: 'DynamicIslandWidget', app_target: nil, push: false }
OptionParser.new do |o|
  o.banner = 'Usage: add-widget-target.rb path/to/App.xcodeproj [options]'
  o.on('--app-target NAME') { |v| options[:app_target] = v }
  o.on('--name NAME') { |v| options[:name] = v }
  o.on('--push') { options[:push] = true }
end.parse!

project_path = ARGV[0] or abort('Pass the path of the .xcodeproj')
project_path = File.expand_path(project_path)
project = Xcodeproj::Project.open(project_path)
project_dir = Pathname(File.dirname(project_path))
widget_dir = Pathname(File.expand_path('../ios-widget', __dir__))
sources = %w[DIRenderer.swift DIWidget.swift DynamicIslandAttributes.swift].map { |f| widget_dir + f }
sources.each { |f| abort("Missing #{f}") unless f.exist? }

app = if options[:app_target]
        project.targets.find { |t| t.name == options[:app_target] }
      else
        project.targets.find { |t| t.respond_to?(:product_type) && t.product_type == 'com.apple.product-type.application' }
      end
abort('App target not found, pass --app-target') unless app

name = options[:name]
widget = project.targets.find { |t| t.name == name }
created = widget.nil?
widget ||= project.new_target(:app_extension, name, :ios, '16.2', nil, :swift)

# --- configurations: mirror the app's (Debug, Release, Staging, ...) ---------------------------------
app.build_configurations.each do |app_config|
  config = widget.build_configurations.find { |c| c.name == app_config.name } ||
           widget.add_build_configuration(app_config.name, app_config.type)
  a = app_config.build_settings
  s = config.build_settings
  app_id = a['PRODUCT_BUNDLE_IDENTIFIER']
  warn "warning: #{app_config.name}: app PRODUCT_BUNDLE_IDENTIFIER is empty, set the widget's by hand" if app_id.nil? || app_id.empty?
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{app_id}.#{name}"
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = (widget_dir + 'Info.plist').relative_path_from(project_dir).to_s
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['INFOPLIST_KEY_CFBundleDisplayName'] = name
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
  %w[DEVELOPMENT_TEAM CODE_SIGN_STYLE CODE_SIGN_IDENTITY MARKETING_VERSION CURRENT_PROJECT_VERSION].each do |key|
    a.key?(key) ? s[key] = a[key] : s.delete(key)
  end
  # The widget must not inherit the app's CocoaPods xcconfig.
  config.base_configuration_reference = nil
end
widget.build_configuration_list.default_configuration_name = app.build_configuration_list.default_configuration_name

# --- sources (referenced in place) --------------------------------------------------------------------
group = project.main_group.children.find { |g| g.display_name == name } || project.main_group.new_group(name)
widget.source_build_phase.files_references.dup.each { |ref| widget.source_build_phase.remove_file_reference(ref) }
sources.each do |file|
  ref = group.files.find { |r| r.real_path == file } || group.new_reference(file.to_s)
  widget.source_build_phase.add_file_reference(ref, true)
end
plist = widget_dir + 'Info.plist'
group.files.find { |r| r.real_path == plist } || group.new_reference(plist.to_s)
%w[SwiftUI WidgetKit ActivityKit].each do |fw|
  ref = project.frameworks_group.files.find { |f| f.path == "System/Library/Frameworks/#{fw}.framework" }
  ref ||= project.frameworks_group.new_reference("System/Library/Frameworks/#{fw}.framework", :sdk_root)
  widget.frameworks_build_phase.add_file_reference(ref, true)
end

# --- embed in the app ---------------------------------------------------------------------------------
app.add_dependency(widget) unless app.dependencies.any? { |d| d.target == widget }
embed = app.copy_files_build_phases.find { |p| p.symbol_dst_subfolder_spec == :plug_ins }
embed ||= app.new_copy_files_build_phase('Embed Foundation Extensions').tap { |p| p.symbol_dst_subfolder_spec = :plug_ins }
unless embed.files_references.include?(widget.product_reference)
  build_file = embed.add_file_reference(widget.product_reference, true)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

project.save

# --- app Info.plist(s) ----------------------------------------------------------------------------------
srcroot = project_dir
plists = app.build_configurations.map { |c| c.build_settings['INFOPLIST_FILE'] }.compact.uniq
plists.each do |rel|
  path = srcroot + rel.gsub('$(SRCROOT)/', '').gsub('$(PROJECT_DIR)/', '')
  unless path.exist?
    warn "warning: #{rel} not found, add NSSupportsLiveActivities = YES to it by hand"
    next
  end
  info = Xcodeproj::Plist.read_from_path(path.to_s)
  info['NSSupportsLiveActivities'] = true
  info['LiveIsland_EnablePush'] = true if options[:push]
  Xcodeproj::Plist.write_to_path(info, path.to_s)
end

puts "#{created ? 'Added' : 'Updated'} #{name} (#{app.build_configurations.map(&:name).join(', ')}) → embedded in #{app.name}"
puts "Info.plist: NSSupportsLiveActivities = YES in #{plists.join(', ')}"
puts 'Next: pod install, then build. New bundle ids may need provisioning (automatic signing handles it).'
