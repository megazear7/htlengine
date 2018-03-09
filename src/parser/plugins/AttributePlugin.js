/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
const Plugin = require('../html/Plugin');
const VariableBinding = require('../commands/VariableBinding');
const Conditional = require('../commands/Conditional');
const OutText = require('../commands/OutText');
const OutputVariable = require('../commands/OutputVariable');
const Loop = require('../commands/Loop');
const NumericConstant = require('../htl/nodes/NumericConstant');
const MapLiteral = require('../htl/nodes/MapLiteral');
const PropertyAccess = require('../htl/nodes/PropertyAccess');
const BooleanConstant = require('../htl/nodes/BooleanConstant');
const BinaryOperation = require('../htl/nodes/BinaryOperation');
const BinaryOperator = require('../htl/nodes/BinaryOperator');
const StringConstant = require('../htl/nodes/StringConstant');
const NullLiteral = require('../htl/nodes/NullLiteral');
const RuntimeCall = require('../htl/nodes/RuntimeCall');
const UnaryOperation = require('../htl/nodes/UnaryOperation');
const UnaryOperator = require('../htl/nodes/UnaryOperator');
const Identifier = require('../htl/nodes/Identifier');
const Expression = require('../htl/nodes/Expression');
const ExpressionContext = require('../html/ExpressionContext');
const MarkupContext = require('../html/MarkupContext');

const BLACKLIST_ATTRIBUTE = /^(style|(on.*))$/;

function escapeNodeWithHint(ctx, node, markupContext, hint) {
    if (hint != null) {
        //todo: this is not the indicated way to escape via XSS. Correct after modifying the compiler context API
        return new RuntimeCall('xss', node, {
            'context': new StringConstant(markupContext),
            'hint': hint
        });
    }
    return ctx.adjustToContext(new Expression(node), markupContext, ExpressionContext.ATTRIBUTE).root;
}

function decodeAttributeName(signature) {
    const args = signature.arguments;
    if (args.length > 0) {
        return args.join('-');
    }
    return null;
}

class SingleAttributePlugin extends Plugin {

    constructor(signature, ctx, expression, attributeName) {
        super(signature, ctx, expression);
        this.writeAtEnd = true;
        this.beforeCall = true;
        this.attributeName = attributeName;
        this.attrValue = ctx.generateVariable("attrValue_" + attributeName);
        this.escapedAttrValue = ctx.generateVariable("attrValueEscaped_" + attributeName);
        this.isTrueValue = ctx.generateVariable("isTrueValue_" + attributeName);
        this.shouldDisplayAttribute = ctx.generateVariable("shouldDisplayAttr_" + attributeName);
        this.node = expression.root;
        this.contentNode = new Identifier(this.attrValue);
        if (!expression.containsOption('context')) {
            this.contentNode = escapeNodeWithHint(ctx, this.contentNode, MarkupContext.ATTRIBUTE, new StringConstant(attributeName));
        }
    }

    beforeAttribute(stream, attributeName) {
        if (attributeName === this.attributeName) {
            if (this.beforeCall) {
                this._emitStart(stream);
            }
            this.writeAtEnd = false;
        }
    }

    beforeAttributeValue(stream, attributeName, attributeValue) {
        if (attributeName === this.attributeName && this.beforeCall) {
            this._emitWrite(stream);
            stream.beginIgnore();
        }
    }

    afterAttributeValue(stream, attributeName) {
        if (attributeName === this.attributeName && this.beforeCall) {
            stream.endIgnore();
        }
    }

    afterAttribute(stream, attributeName) {
        if (attributeName === this.attributeName && this.beforeCall) {
            this._emitEnd(stream);
        }
    }

    afterAttributes(stream) {
        if (this.writeAtEnd) {
            this._emitStart(stream);
            stream.write(new OutText(" " + this.attributeName));
            this._emitWrite(stream);
            this._emitEnd(stream);
        }
    }

    onPluginCall(stream, signature, expression) {
        if ('attribute' === signature.name) {
            const attributeName = decodeAttributeName(signature);
            if (this.attributeName === attributeName) {
                this.beforeCall = false;
            }
        }
    }

    _emitStart(stream) {
        stream.write(new VariableBinding.Start(this.attrValue, this.node));
        stream.write(new VariableBinding.Start(this.escapedAttrValue, this.contentNode));
        stream.write(
            new VariableBinding.Start(
                this.shouldDisplayAttribute,
                new BinaryOperation(
                    BinaryOperator.OR,
                    new Identifier(this.escapedAttrValue),
                    new BinaryOperation(BinaryOperator.EQ, new StringConstant("false"), new Identifier(this.attrValue))
                )
            )
        );
        stream.write(new Conditional.Start(this.shouldDisplayAttribute, true));
    }

    _emitWrite(stream) {
        stream.write(new VariableBinding.Start(this.isTrueValue,
            new BinaryOperation(BinaryOperator.EQ,
                new Identifier(this.attrValue),
                BooleanConstant.TRUE)
            )
        );
        stream.write(new Conditional.Start(this.isTrueValue, false));
        stream.write(new OutText('="'));
        stream.write(new OutputVariable(this.escapedAttrValue));
        stream.write(new OutText('"'));
        stream.write(Conditional.END);
        stream.write(VariableBinding.END);
    }

    _emitEnd(stream) {
        stream.write(Conditional.END);
        stream.write(VariableBinding.END);
        stream.write(VariableBinding.END);
        stream.write(VariableBinding.END);
    }

}

class MultiAttributePlugin extends Plugin {

    constructor(signature, ctx, expression) {
        super(signature, ctx, expression);

        this.attrMap = expression.root;
        this.attrMapVar = ctx.generateVariable("attrMap");
        this.beforeCall = true;
        this.ignored = {};
    }

    beforeAttributes(stream) {
        stream.write(new VariableBinding.Start(this.attrMapVar, this.attrMap));
    }

    beforeAttribute(stream, attributeName) {
        this.ignored[attributeName] = new BooleanConstant(true);
        if (this.beforeCall) {
            const attrNameVar = this.pluginContext.generateVariable("attrName_" + attributeName);
            const attrValue = this.pluginContext.generateVariable("mapContains_" + attributeName);
            stream.write(new VariableBinding.Start(attrNameVar, new StringConstant(attributeName)));
            stream.write(new VariableBinding.Start(attrValue, this._attributeValueNode(new StringConstant(attributeName))));
            this._writeAttribute(stream, attrNameVar, attrValue);
            const varExistsVar = this.pluginContext.generateVariable("varExists");
            stream.write(new VariableBinding.Start(varExistsVar, new BinaryOperation(BinaryOperator.NEQ, new Identifier(attrValue), NullLiteral.INSTANCE)));
            stream.write(new Conditional.Start(varExistsVar, false));
        }
    }

    afterAttribute(stream, attributeName) {
        if (this.beforeCall) {
            stream.write(Conditional.END);
            stream.write(VariableBinding.END);
            stream.write(VariableBinding.END);
            stream.write(VariableBinding.END);
        }
    }

    onPluginCall(stream, signature, expression) {
        if ('attribute' === signature.name) {
            const attrName = decodeAttributeName(signature);
            if (attrName == null) {
                this.beforeCall = false;
            } else {
                if (!this.beforeCall) {
                    this.ignored[attrName] = new BooleanConstant(true);
                }
            }
        }
    }

    afterAttributes(stream) {
        const ctx = this.pluginContext;
        const ignoredLiteral = new MapLiteral(this.ignored);
        const ignoredVar = ctx.generateVariable("ignoredAttributes");
        stream.write(new VariableBinding.Start(ignoredVar, ignoredLiteral));
        const attrNameVar = ctx.generateVariable("attrName");
        const attrNameEscaped = ctx.generateVariable("attrNameEscaped");
        const attrIndex = ctx.generateVariable("attrIndex");
        stream.write(new Loop.Start(this.attrMapVar, attrNameVar, attrIndex));
        stream.write(new VariableBinding.Start(attrNameEscaped, this._escapeNode(new Identifier(attrNameVar), MarkupContext.ATTRIBUTE_NAME, null)));
        stream.write(new Conditional.Start(attrNameEscaped, true));
        const isIgnoredAttr = ctx.generateVariable("isIgnoredAttr");
        stream.write(new VariableBinding.Start(isIgnoredAttr, new PropertyAccess(new Identifier(ignoredVar), new Identifier(attrNameVar))));
        stream.write(new Conditional.Start(isIgnoredAttr, false));
        const attrContent = ctx.generateVariable("attrContent");
        stream.write(new VariableBinding.Start(attrContent, this._attributeValueNode(new Identifier(attrNameVar))));
        this._writeAttribute(stream, attrNameEscaped, attrContent);
        stream.write(VariableBinding.END); //end of attrContent
        stream.write(Conditional.END);
        stream.write(VariableBinding.END);
        stream.write(Conditional.END);
        stream.write(VariableBinding.END);
        stream.write(Loop.END);
        stream.write(VariableBinding.END);
        stream.write(VariableBinding.END);
    }

    _writeAttribute(stream, attrNameVar, attrContentVar) {
        const escapedContent = this.pluginContext.generateVariable("attrContentEscaped");
        const shouldDisplayAttribute = this.pluginContext.generateVariable("shouldDisplayAttr");
        stream.write(
            new VariableBinding.Start(escapedContent, this._escapedExpression(new Identifier(attrContentVar), new Identifier(attrNameVar)))
        );
        stream.write(
            new VariableBinding.Start(
                shouldDisplayAttribute,
                new BinaryOperation(
                    BinaryOperator.OR,
                    new Identifier(escapedContent),
                    new BinaryOperation(BinaryOperator.EQ, new StringConstant("false"), new Identifier(attrContentVar))
                )
            )
        );
        stream.write(new Conditional.Start(shouldDisplayAttribute, true));
        stream.write(new OutText(" "));   //write("attrName");
        this._writeAttributeName(stream, attrNameVar);
        this._writeAttributeValue(stream, escapedContent, attrContentVar);
        stream.write(Conditional.END);
        stream.write(VariableBinding.END);
        stream.write(VariableBinding.END);
    }

    _writeAttributeName(stream, attrNameVar) {
        stream.write(new OutputVariable(attrNameVar));
    }

    _writeAttributeValue(stream, escapedContent, attrContentVar) {
        const isTrueVar = this.pluginContext.generateVariable("isTrueAttr"); // holds the comparison (attrValue == true)
        stream.write(new VariableBinding.Start(isTrueVar, //isTrueAttr = (attrContent == true)
            new BinaryOperation(BinaryOperator.EQ, new Identifier(attrContentVar), BooleanConstant.TRUE)));
        stream.write(new Conditional.Start(isTrueVar, false)); //if (!isTrueAttr)
        stream.write(new OutText("=\""));

        stream.write(new OutputVariable(escapedContent)); //write(escapedContent)

        stream.write(new OutText("\""));
        stream.write(Conditional.END); //end if isTrueAttr
        stream.write(VariableBinding.END); //end scope for isTrueAttr
    }

    _attributeValueNode(attributeNameNode) {
        return new PropertyAccess(new Identifier(this.attrMapVar), attributeNameNode);
    }

    _escapedExpression(original, hint) {
        return this._escapeNode(original, MarkupContext.ATTRIBUTE, hint);
    }

    _escapeNode(node, markupContext, hint) {
        return escapeNodeWithHint(this.pluginContext, node, markupContext, hint);
    }

}

module.exports = class AttributePlugin extends Plugin {

    constructor(signature, ctx, expression) {
        super(signature, ctx, expression);
        const attributeName = decodeAttributeName(signature);
        this.writeAtEnd = true;
        this.beforeCall = true;
        this.attributeName = attributeName;
        this.delegate = attributeName == null
            ? new MultiAttributePlugin(signature, ctx, expression)
            : new SingleAttributePlugin(signature, ctx, expression, attributeName);
    }

    isValid() {
        if (this.attributeName == null || !BLACKLIST_ATTRIBUTE.test(this.attributeName)) {
            return true;
        }
        const warningMessage =
            `Sensible attribute (${this.attributeName}) detected: event attributes (on*) and the style attribute ` +
            `cannot be generated with the data-sly-attribute block element; if you need to output a dynamic value for ` +
            `this attribute then use an expression with an appropriate context.`;
        this.pluginContext.stream.warn(warningMessage, this.expression.rawText);
        return false;
    }

    beforeAttributes() {
        this.delegate.beforeAttributes.apply(this.delegate, arguments);
    }

    beforeAttribute(stream, attributeName) {
        this.delegate.beforeAttribute.apply(this.delegate, arguments);
    }

    beforeAttributeValue(stream, attributeName, attributeValue) {
        this.delegate.beforeAttributeValue.apply(this.delegate, arguments);
    }

    afterAttributeValue(stream, attributeName) {
        this.delegate.afterAttributeValue.apply(this.delegate, arguments);
    }

    afterAttribute(stream, attributeName) {
        this.delegate.afterAttribute.apply(this.delegate, arguments);
    }

    afterAttributes(stream) {
        this.delegate.afterAttributes.apply(this.delegate, arguments);
    }

    onPluginCall(stream) {
        this.delegate.onPluginCall.apply(this.delegate, arguments);
    }

};