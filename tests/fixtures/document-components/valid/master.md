# Master corpus — café, 東京, 🧪

DOC_COMPONENT_MASTER_SEED before source components; Unicode stays exact: café · 東京 · Ω · é.

<Annotation id="ann-master-1" type="personal" comment="Revisar ✓">frase anotada á</Annotation>, <Entity id="entity-master-1" type="person" ref="people/ada">Ada 🚀</Entity> y <Highlight color="yellow">importante ✨</Highlight>.

<Tip title="Tip maestro">
TIP_BODY_MASTER — conserva listas y Markdown:

- primer punto
- segundo punto
</Tip>

<Info title="Info maestra">
INFO_BODY_MASTER con **negritas** y ñ.
</Info>

<Card title="Card maestro" icon="star" href="https://example.com/master?a=1&amp;b=2">
CARD_BODY_MASTER con **énfasis**, un [enlace seguro](https://example.com/card) y línea literal.
</Card>

```tsx
// Una etiqueta en un fence es texto literal, no un componente:
<Card title="Fence literal">LITERAL_FENCE_MASTER</Card>
```

<ProtectedText id="lock-master-1" reason="source only — no Rich writer">OPAQUE_PROTECTED_MASTER 🔒</ProtectedText>

<FuturePanel version="v9" token="keep-exact">OPAQUE_FUTURE_MASTER 東京</FuturePanel>

<Card title={unsafe()} onClick="steal()" unknown="reject">
OPAQUE_INVALID_ATTRS_MASTER — preserve this complete span.
</Card>

<Widget mode="future" />

Tail after opaque source: TAIL_MASTER remains editable.

<OpenPanel mode="future">
OPAQUE_UNCLOSED_MASTER
<Annotation id="ann-master-after-invalid" type="personal" comment="after opaque">ANNOTATION_AFTER_INVALID_MASTER</Annotation>
