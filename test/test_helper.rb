ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

module SimpleStub
  def stub(method_name, replacement)
    singleton = singleton_class
    existed = singleton.method_defined?(method_name) || singleton.private_method_defined?(method_name)
    original = method(method_name) if respond_to?(method_name, true)

    singleton.define_method(method_name) do |*args, **kwargs, &block|
      replacement.respond_to?(:call) ? replacement.call(*args, **kwargs, &block) : replacement
    end
    yield
  ensure
    if existed && original
      singleton.define_method(method_name, original)
    else
      singleton.remove_method(method_name) if singleton.method_defined?(method_name)
    end
  end
end

Object.include(SimpleStub)

module ActiveSupport
  class TestCase
    parallelize(workers: :number_of_processors)
    fixtures :all
  end
end
