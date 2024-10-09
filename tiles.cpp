#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/Shape.hpp>
#include <SFML/System/Vector2.hpp>
#include <cmath>
#include <cstdlib>
#include <string>
#include <array>
#include <vector>
#include <stdio.h>
#include <math.h>
#include <SFML/Graphics.hpp>

#define windowsize 512
using namespace std;
#define bnum 2
typedef float dbl;
typedef sf::Vector2f v2f;
class Node;

int uniform(int a, int b) {
    return (rand() % (b-a))+a; 
}
int uniform(int b) {
    return uniform(0, b); 
}
dbl scale = 10;
dbl thickness = 4;
v2f isoproject(int x, int y, int z) {
    v2f v = sf::Vector2f((int) (windowsize/2+x-y), (int) (windowsize/2+y+x-z*scale)/2);
    return v;
}
v2f isoprojectrot(int x, int y, int z, dbl rot) {
    v2f v = sf::Vector2f((int) (windowsize/2+x*cos(rot)-y*sin(rot)), (int) (windowsize/2+y*cos(rot)+x*sin(rot)-z*scale)/2);
    return v;
}
class Square {
public:
    int x, y, z;
    sf::ConvexShape shape;
    Square(int x, int y, int z, sf::Color c) : x(x), y(y), z(z) {
        shape.setPointCount(4);
        shape.setFillColor(c);
    }
    
    void draw(dbl rot) {
        shape.setPosition(isoprojectrot(x*scale*5, y*scale*5, z*thickness, rot));
        dbl bsize = 2*scale;
        shape.setPoint(0, isoproject(
            -cos(rot)*bsize,
            -sin(rot)*bsize,
            z
        ));
        shape.setPoint(1, isoproject(
            cos(rot+M_PI/2)*bsize,
            sin(rot+M_PI/2)*bsize,
            z
        ));
        shape.setPoint(2, isoproject(
            cos(rot)*bsize,
            sin(rot)*bsize,
            z
        ));
        shape.setPoint(3, isoproject(
            cos(rot-M_PI/2)*bsize,
            sin(rot-M_PI/2)*bsize,
            z
        ));
    }
};
class Tile {
public:
    int x, y, z;
    Square top;
    sf::ConvexShape shape;
    Tile(int x, int y, int z, sf::Color c) : x(x), y(y), z(z), top(x, y, z, c) {
        shape.setPointCount(5);
        shape.setFillColor(sf::Color(c.r/2, c.g/2, c.b/2));
    }
    void draw(dbl rot) {
        top.draw(rot);
        shape.setPosition(isoprojectrot(x*scale*5, y*scale*5, z*thickness, rot));
        dbl bsize = 2*scale;
        int i = 0;
        dbl mod = M_PI/2;
        rot = rot-mod* (int) (rot/mod);
        shape.setPoint(0, isoproject(
            cos(rot+M_PI/2)*bsize,
            sin(rot+M_PI/2)*bsize,
            z
        ));
        shape.setPoint(1, isoproject(
            cos(rot+M_PI/2)*bsize,
            sin(rot+M_PI/2)*bsize,
            z-thickness
        ));
        shape.setPoint(2, isoproject(
            cos(rot)*bsize,
            sin(rot)*bsize,
            z-thickness
        ));

        shape.setPoint(3, isoproject(
            cos(rot-M_PI/2)*bsize,
            sin(rot-M_PI/2)*bsize,
            z-thickness
        ));
        shape.setPoint(4, isoproject(
            cos(rot-M_PI/2)*bsize,
            sin(rot-M_PI/2)*bsize,
            z
        ));
    }
};

vector<Node*> all;
class Node {
public:
    int ID;
    // Square shape;
    Tile shape;
    Node(int x, int y, int z, sf::Color c) : shape(x, y, z, c) {
        all.push_back(this);
        ID = all.size();
    }
    
    void draw(dbl rot=M_PI/4) {shape.draw(rot);}
};

int main() {
    sf::RenderWindow window(sf::VideoMode(windowsize, windowsize), "market");
    int lightness = 220;
    // for (int i = 0; i < 25; i++) {
    //     new Node(uniform(5), uniform(5), sf::Color(rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    // }
    new Node(0, 0, 0, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    // new Node(0, 2, 1, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    // new Node(0, 2, 0, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    // new Node(0, 2, 2, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    new Node(0, 2, 0, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    new Node(0, 2, 1, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    new Node(0, 2, 3, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    new Node(0, -2, 0, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    new Node(0, -2, 2, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    new Node(0, -2, 3, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    new Node(0, -2, 4, sf::Color(100*rand()%lightness+lightness, rand()%lightness+lightness, rand()%lightness+lightness));
    dbl rot = 0;
    while (window.isOpen()) {
        sf::Event event;
        while (window.pollEvent(event)) {
            if (event.type == sf::Event::Closed) {window.close();}
            if (sf::Keyboard::isKeyPressed(sf::Keyboard::Left)) {rot += M_PI/100;}
        }
        window.clear(sf::Color(0xe1d5bb00));
        for (Node* node : all) {node->draw(rot);}
        for (Node* node : all) {
            window.draw(node->shape.shape);
            window.draw(node->shape.top.shape);
        }
        window.display();
        window.setFramerateLimit(60);
    }
    printf("\n");
}
