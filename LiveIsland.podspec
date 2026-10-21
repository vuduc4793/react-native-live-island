require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "LiveIsland"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/vuduc4793/react-native-live-island"
  s.license      = package["license"]
  s.authors      = "MTT"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/vuduc4793/react-native-live-island.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"
  s.frameworks = "UIKit"
  s.weak_frameworks = "ActivityKit"

  install_modules_dependencies(s)
end
