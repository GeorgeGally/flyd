module MarkdownHelper
  def markdown(text)
    return "" if text.blank?

    html = Commonmarker.to_html(text, options: {
      parse: { smart: true },
      render: { hardbreaks: true, unsafe: false }
    })

    html.html_safe
  end
end
